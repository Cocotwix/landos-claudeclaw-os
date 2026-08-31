// LandOS dashboard API routes — OS Spine v1.
//
// Mounted into the existing dashboard Hono app (src/dashboard.ts) behind the
// existing token auth middleware, before the SPA catch-all. Everything here
// is repo-safe metadata and counts: no secrets, no LP tokens, no paid calls.

import type { Hono } from 'hono';

import { logger } from '../logger.js';
import { generateContent, generateVisionContent, parseJsonResponse } from '../gemini.js';
import { DEPARTMENTS } from './departments.js';
import {
  GATED_ACTION_TYPES,
  PROHIBITED_ACTION_TYPES,
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
  isProhibitedActionType,
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
import { resolveHermesUrl, resolveLiveRouting, resolveOllamaHost, setLiveRouting, setOllamaHost } from './router-runtime-config.js';
import { describeMissionProviderCatalog } from './mission-provider-routing.js';
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
import { buildPracticalMarketMatrix, runMarketScan, type ScanFinding, type ScanSearchFn, type MarketScanResult, type InternalCountyAcreageSnapshot } from './market-scan.js';
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
  updateCardNextAction,
  deleteCardNextAction,
  attachNearbySearchReference,
  createLeadJobs,
  listLeadJobs,
  updateLeadJob,
  loadCardVisualCapture,
  loadEligibleCardVisualCapture,
  loadPropertyInspection,
  savePropertyInspection,
  saveVisualIntelligence,
  loadVisualIntelligence,
  getPropertyCardRow,
  getCardActivity,
  upsertPropertyCard,
} from './property-card.js';
import { isOperatorEntryOnlyLandPortalUrl, isVerifiedLandPortalSubjectUrl, landPortalIdentityFromUrl, operatorLandPortalEntryUrl, sameLandPortalParcel } from './landportal-operating-rules.js';
import { stateFromCountyFips } from './landportal-canonical-identity.js';
import { listIntakeLinks, operatorLandPortalEntryUrlForDeal, recordIntakeLinks } from './intake-links.js';
import { operatorSuppliedSubjectFor } from './operator-supplied-subject.js';
import { isAcceptedLandPortalVisualForProperty } from './landportal-evidence-validation.js';
import { captureAndPersistAcceptedIdentityVisuals, captureAndPersistCardVisuals } from './visual-capture-workflow.js';
import { reconcileDiscoveryIdentity } from './discovery-identity.js';
import { resolveGoogleVisualEnv, VISUAL_SERVICES } from './providers/google-visual.js';
import fs from 'fs';
import path from 'path';
import { routeDukeRequest } from './duke-router.js';
import { LANDPORTAL_VERIFICATION_TIMEOUT_MS } from './duke-report-lanes.js';
import { runDukeVerification, type DukeVerificationResult } from './duke-verification-bridge.js';
import { distanceMiles, fetchZillowLandComps } from './zillow-land-comps.js';
import { fetchRedfinLandComps, fetchRedfinListingDetail } from './redfin-land-comps.js';
import { RECENT_SALE_WINDOW_MONTHS, type SoldSearchWindowMonths } from './comp-sale-recency.js';
import { fetchLandWatchLandComps } from './landwatch-land-comps.js';
import { fetchRealtorLandComps } from './realtor-land-comps.js';
import { runBrockovichDataCenterMap } from './brockovich-data-center.js';
import {
  createPlaceGeocoder,
  resolveCandidateLocation,
  runDataCenterProximityScreen,
  DATA_CENTER_SCREEN_RADIUS_MILES,
} from './data-center-proximity.js';
import { composeScanSearch, hermesScanSearch } from './market-scan-search.js';
import { extractPropertyArgs } from './duke-preflight.js';
import { suggestAddresses } from './address-suggest.js';
import { classifySmartIntake, listIntakeIntents, type ParsedIntakeFields } from './intake-router.js';
import { extractZipCandidate, extractApnCandidates } from './intake-normalize.js';
import { buildSmartIntake } from './smart-intake.js';
import { parseConversationalLeadIntake } from './conversational-lead-intake.js';
import { buildLeadCardTitle, streetReferenceFrom, unresolvedLeadStorageLabel, isPlaceholderPropertyLabel } from './lead-identity.js';
import { planResolver, smallestNextIdentifier, type IntakeFields } from './resolver-planner.js';
import { apnSearchVariants, ownerSearchVariants, lpResolveForPreflight, type LpResolveResult } from './landportal-client.js';
import { buildDiscoveryCallReport, buildConfirmedParcelDiscoveryReport, buildAreaDiscoveryReport, type DiscoveryIntake } from './discovery-call-report.js';
import { capabilityPrerequisites, invokeRuntimeCapability, listRuntimeCapabilities, runtimeCapability } from './capability-registry.js';
import {
  ACQUISITION_INTELLIGENCE_CAPABILITY_ID,
  propertyFileIsSufficient,
} from './acquisition-intelligence-capability.js';
import {
  buildAcquisitionDossier,
  type PropertyFileSource as AcquisitionPropertyFileSource,
} from './acquisition-intelligence-dossier.js';
import {
  createHermesAcquisitionAnalyst,
  dossierFingerprint as acquisitionDossierFingerprint,
  acquisitionAnalystRuntimeStatus,
} from './acquisition-analyst.js';
import {
  createIntelligenceExecutor,
  intelligenceExecutorRuntimeStatus,
} from './specialist-intelligence-executor.js';
import { readAcquisitionIntelligence } from './acquisition-intelligence-store.js';
import { setDealWarRoomContextProvider, boundContextText } from './war-room-deal-context.js';
import { ASSESSOR_TAX_CAPABILITY_ID } from './assessor-tax-capability.js';
import {
  LANDPORTAL_RESEARCH_CAPABILITY_ID,
  type LandPortalAgenticOutcome,
  type LandPortalInspectionOutcome,
} from './landportal-research-capability.js';
import {
  COMPS_VALUATION_CAPABILITY_ID,
  type CompCollectionOutcome,
  type MissionValuationOutcome,
} from './comps-valuation-capability.js';
import {
  ZONING_SUBDIVISION_CAPABILITY_ID,
  projectZoningSubdivisionWithCurrentTruth,
  type LandUseResearchOutcome,
} from './zoning-subdivision-capability.js';
import { PROPERTY_DEVELOPMENT_HISTORY_CAPABILITY_ID } from './property-development-history-capability.js';
import type { PropertyBackstory } from './property-backstory.js';
import { CapabilityInvocationStore } from './capability-store.js';
import { readAcreageExtentRecord, runOfficialAcreageExtentReconciliation } from './official-acreage-run.js';
import { runAcreageDependentRefresh } from './acreage-dependent-refresh.js';
import { deriveOperatorDisplayLocation } from './operator-display-location.js';
import type { CapabilityEntity } from './capability-contract.js';
import { researchReadinessItem } from './research-readiness.js';
import { isReconcileError, reconcileResearchReadiness } from './research-readiness-reconcile.js';
import { runResearchReadinessBackfill } from './research-readiness-backfill.js';
import {
  planResearchCoverage,
  runResearchCoverageCycle,
  specialistEvidenceRequirements,
  type ResearchCoverageCycleResult,
} from './research-coverage-cycle.js';
import {
  applyRunEvent,
  cancelRunProgress,
  finishRunProgress,
  startRunProgress,
} from './intelligence-run-progress.js';
import { IntelligenceStackRunStore } from './intelligence-stack-run-store.js';
import { runMarketPrerequisiteWork } from './market-prerequisite-scheduler.js';
import { readIntelligenceStackState, runIntelligenceStack } from './intelligence-stack.js';
import {
  DEAL_INTELLIGENCE_PRODUCT_TYPE,
  PROPERTY_INTELLIGENCE_PRODUCT_TYPE,
  dealBrainChatPrompt,
  marketDossierView,
  propertyDossierView,
  retainedProductProjection,
  sellerDossierView,
  specialistContextEnvelopeForPhase,
  type DealIntelligenceProduct,
  type IntelligenceLayerId,
  type PropertyIntelligenceProduct,
} from './intelligence-stack-contract.js';
import {
  appendDealBrainGuidance,
  listDealBrainGuidance,
  projectCurrentDealBrainGuidance,
  retireDealBrainReplies,
} from './deal-brain-guidance.js';
import { buildSupervisorEvidence, runSmartIntakeSupervisor } from './smart-intake-supervisor.js';
import { readDerivedSnapshot, writeDerivedSnapshot } from './derived-intelligence-store.js';
import {
  INTELLIGENCE_RECONCILIATION_SNAPSHOT_TYPE,
  capabilityInvocationFor,
  derivePropertyCapabilityRequests,
  projectCurrentIntelligenceReconciliation,
  runIntelligenceReconciliation,
  validateIntelligenceCapabilityRequest,
  type IntelligenceReconciliationRecord,
} from './intelligence-capability-reconcile.js';
import { PROPERTY_RESOLUTION_CAPABILITY_ID } from './property-resolution-capability.js';
import { reconcileAttemptWithAcceptedIdentity } from './intake-resolution-reconciliation.js';
import { browserLaneStatus } from './browser-retrieval.js';
import { makeLandPortalBrowser } from './landportal-browser.js';
import { listNavigationModels } from './browser-navigation-model.js';
import { listSitePlaybooks } from './browser-learning.js';
import { makeCountyRecordsBrowser } from './county-records-browser.js';
import { routeBrowserQuestion, type BrowserEvidence } from './browser-intelligence.js';
import { containsRejectedParcelRecordDestination, isRejectedParcelRecordDestination } from './browser-navigator.js';
import { makeLiveBrowserDriver, ensureBrowserSession, ensureBrowserSessionReady, browserSessionHealth, browserSessionStatus, startBrowserSession, openLandPortalInSession, withWorkingPage, ensureLandPortalAuthenticated, readLandPortalCreds, closeSurplusSessionPages, adoptAutomationControlPage } from './browser-session.js';
import { reapOrphanAutomationTabs, reclaimStrandedAutomationTabs } from './automation-browser.js';
import { getCountySources } from './county-source-map.js';
import { officialDomainScore, searchEngineUrl, sourceContradictsRequestedState, unwrapSearchResults } from './netr-routing.js';
// Exact-address discovery reads engines and listing pages through the dedicated
// LandOS browser; the engines and the listing hosts both refuse a bare fetch.
import { defaultGovFetchText, extractLinks, htmlToText as htmlBodyToText } from './gis-transport.js';
import { createHermesFreeSearch } from './hermes-free-search.js';
import { createBackgroundBrowserFetchText } from './gov-browser-transport.js';
import { withOwnedPages } from './browser-owned-pages.js';
import { LANDPORTAL_PROPERTY_CHARACTERISTICS_CAPABILITY_ID } from './landportal-property-characteristics-capability.js';
import { LANDPORTAL_VISUAL_CAPTURE_CAPABILITY_ID } from './landportal-visual-capture-capability.js';
import { LANDPORTAL_COMP_SEARCH_CAPABILITY_ID, type SecondarySearchResult } from './landportal-comp-search-capability.js';
import { projectUtilityAvailability } from './utility-availability-record.js';
import { loadUtilityAvailabilityRecord } from './utility-service-screen-capability.js';
import { readResolverSubject } from './universal-property-resolution.js';
import { CountyCapabilityRegistry } from './county-capability-registry.js';
import { PUBLIC_INTELLIGENCE_TASKS, normalizeParcelIdentifier, type PublicIntelligenceRun, type PublicIntelligenceSubject } from './public-property-intelligence.js';
import { runPropertyIntelligenceOrchestrator } from './property-intelligence-orchestrator.js';
import { governmentFactsFromPublicRecordOutcomes, lookupOfficialParcel, officialParcelPatch, publicSubjectFromOfficialParcel, makeLivePublicIntelligenceAdapters, makeParcelIndependentIntelligenceAdapters, makeOfficialParcelBlockedAdapters, makePracticalSubjectAttemptAdapters, makePracticalDiscoveryScreeningAdapters, makeCountyGisZoningSupplement, practicalOfficialParcelSources, officialParcelSourceCoverage } from './public-property-intelligence-live.js';
import { makeZoningLandUseAdapter } from './land-use-intelligence-adapter.js';
import { PublicIntelligenceStore, type StoredPublicIntelligenceRun } from './public-intelligence-store.js';
import { PropertyIntelligenceStore } from './property-intelligence-store.js';
import { PropertyResearchStore } from './property-research-store.js';
import {
  getHermesLandPortalLaneProgress,
  hermesLandPortalPropertyLabel,
  runHermesLandPortalLane,
  type HermesLandPortalLaneOutcome,
} from './hermes-landportal-auto.js';
import { loadVisualBuyerAnalysis } from './visual-buyer-analysis.js';
import { buildVisualBuyerNarrative } from './visual-buyer-narrative.js';
import { reconcileMissingDiligence } from './missing-diligence-reconciliation.js';
import {
  apparentEntranceAttribution,
  apparentEntranceFromObservations,
  normalizeDiscoveryAccessItems,
  presentBuyerAnalysisAccessLanguage,
  presentDiscoveryAccessEvidence,
  readDiscoveryAccess,
} from './discovery-access-presentation.js';
import type { AccessEvidenceItem } from './access-evidence-ladder.js';
import { buildSoilsSepticOutlook, loadSoilsSepticScreening } from './soils-septic-outlook.js';
import { launchDealIntelligenceMission } from './deal-intelligence-run.js';
import { reconcileSubjectIdentity } from './subject-identity-reconciliation.js';
import { autoLaunchDealIntelligenceForIntake } from './deal-intelligence-intake.js';
import type { SnapshotComps, SnapshotEvidenceItem, SnapshotFact } from './property-intelligence-snapshot.js';
import type {
  ComparablesContribution,
  PropertyIntelligenceCollectors,
  SpecialistOutcome,
} from './property-intelligence-collector-types.js';
import {
  jurisdictionLocalApnVariants,
  presentPropertyIntelligenceSnapshot,
  rederiveSpecialistDelivery,
  researchStatusFrom,
} from './property-intelligence-snapshot.js';
import { tallyResearchLanes } from './research-lane-outcome.js';
import type { DealIntelligenceInputPackage } from './deal-intelligence-assembly.js';
import { buildPropertyIntelligenceStrategies } from './property-intelligence-strategy.js';
import {
  computeMissionCompValuation,
  dealIntelligenceDefinitionShape,
  DEAL_INTELLIGENCE_KIND,
  DEAL_INTELLIGENCE_SCOPE,
  type DealIntelligenceCapabilities,
  type MissionCompValuationInput,
  type MissionCompValuationResult,
} from './deal-intelligence-mission.js';
import {
  livePostResolutionCapabilities,
  runLandUseAuthorityAndZoningForDeal,
  runPropertyBackstoryForDeal,
  runSubdivisionIntelligenceForDeal,
} from './post-resolution-capabilities.js';
import { readControllingAuthority, readCurrentZoning, readZoningStandards } from './land-use-intelligence-store.js';
import { readPropertyBackstory } from './property-backstory-store.js';
import { readPreCallIntelligenceHandoff } from './pre-call-intelligence-handoff.js';
import { MissionGraphStore } from './mission-graph-store.js';
import { readFanOutMission } from './mission-graph-runner.js';
import { canonicalPropertyInputForDeal, governmentArtifactEvidence, makeLivePropertyIntelligenceCollectors, retainedSurveyedAcres, type ExactAddressWebResult } from './property-intelligence-live.js';
import { executePropertyProvider, type NormalizedPropertyEvidence, type PropertyProviderAdapter } from './property-intelligence-contract.js';
import { gatherCardImages, loadCardVisionAnalysis } from './browser-vision.js';
import { investigatePropertyWithGev, loadCardGevSpatialAnalysis } from './gev-property-investigation.js';
import { sanitizeVisualIntelligenceRecord, type VisualIntelligenceRecord } from './visual-intelligence.js';
import { buildDealParcelScopeView, subjectIsVacantLand, type DealParcelScopeView } from './deal-parcel-scope-view.js';
import { buildDealOperatorAnalysis, emptyDealOperatorContext, runWholeCardOperatorAnalyst, type DealOperatorContext, type OperatorResearchAttempt, type ResearchAttemptStatus } from './deal-operator-analysis.js';
import { ManagedIdentityRepository, EnvironmentManagedEmailProvider, managedIdentityStatus } from './managed-identity.js';
import { WindowsCredentialVault } from './windows-credential-vault.js';
import { SqliteGovernmentAccountRepository } from './government-account-manager.js';
import { writeBrowserFact, listBrowserFacts, promoteBrowserFactsToEvidence, requestCancel, isCancelled, clearCancel, markStoppedByOperator } from './browser-fact-store.js';
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
  getHeatmapData, getCountyDrilldown, listReviewQueue, listCountyRef, listFlaggedSnapshots, resolveCountyRefByZip, resolveCountyRefByName,
} from './market-matrix-store.js';
import { makeFixtureMarketProvider, makeLiveBrowserMarketProvider, delegateMarketResearchToBrowserAgent, pickMarketResearchBackend } from './market-browser-provider.js';
import {
  importMatrixBaseline, listMrSnapshots, getMrSnapshot, listMrRows, getMrGeoSummary,
  MR_METRIC_DICTIONARY,
} from './market-research-snapshots.js';
import { collectQuarterlyMarketSnapshot, collectMarketGapFill, collectMarketVerifySweep, isCollectionActive, getCollectionStatus } from './market-research-collector.js';
import { getZipGeometries, zipCentroid } from './market-research-geometry.js';
import { buildMarketMatrixReportSection, resolveMarketMatrix, resolveMarketMatrixSection } from './market-matrix-read.js';
import { propertyMarketContextFor, type PropertyMarketContext } from './property-market-context.js';
import { buildDealCardOwnerAnalysis } from './deal-card-owner-analysis.js';
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
import { listDealCards, getDealCard, createDealCard, updateDealCard, ensureDealCardForProperty, getDealCardIdForPropertyCard, linkPropertyToDeal, listTrashedDealCards, softDeleteDealCard, restoreDealCard, hardDeleteDealCard, addPerson, linkPerson, updateDealPerson, unlinkDealPerson, resolveSubjectPropertyCard } from './deal-card.js';
import { readPropertySummaryForDeal, synchronizePropertySummaryForDeal, reconcileCanonicalIdentity, reconcileAllPendingCanonicalIdentities } from './property-summary-legacy-adapter.js';
import { readGovernmentRecordsForDeal, synchronizeGovernmentRecordsForDeal } from './government-records-legacy-adapter.js';
import { resolveGovernmentRecordArtifactPage } from './government-records-operator.js';
import { readZoningLandUseForDeal, synchronizeZoningLandUseForDeal } from './zoning-legacy-adapter.js';
import { resolveZoningArtifactPage } from './zoning-operator.js';
import { assembleBusinessObjects, whatBlocksThisDeal } from './business-object-spine.js';
import { confirmParcelForDeal, readParcelIdentity, writeParcelIdentity } from './parcel-identity.js';
import { buildCompMapView } from './comp-map.js';
import {
  buildRetainedLocationIndex, compAddressKey, reconcileCompAddress,
  type RetainedLocationRecord,
} from './comp-location-reconciliation.js';
import { readResolutionSnapshot } from './resolution-snapshot.js';
import { getDealCardDd } from './deal-card-dd.js';
import { getDealCardMarket } from './deal-card-market.js';
import { getDealCardReport, runDealCardReport, buildPersistedResolver, buildIdentityText, landFactsForScore, projectPropertyInspectionForReport, projectPropertyIntelligenceSnapshotForReport } from './deal-card-report.js';
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
import { getLandosStorageProfile, landosArtifactPath } from './storage-profile.js';
import {
  ensureOpportunityForLegacyDealCard,
  getExecutiveOpportunitySnapshot,
  getOpportunity,
  getOpportunityByDealCardId,
  getOpportunityDetail,
  listOpportunityBoardCards,
  listOpportunities,
  OPPORTUNITY_PIPELINE_STAGES,
  ownerDisposeOpportunity,
  ownerPursueOpportunity,
  setOpportunityPipelineStage,
  updateOpportunityTitle,
  updateOpportunityResearchStatus,
  updateOpportunityDiscoveryStatus,
  type OpportunityRecord,
} from './opportunity.js';
import {
  buildOpportunityDiscoveryPackage,
  renderDiscoveryPackageMarkdown,
} from './opportunity-discovery-package.js';
import {
  claimResearchMission,
  createResearchMission,
  failResearchMission,
  finishResearchMission,
  getResearchMission,
  latestResearchMission,
  listQuarantinedResearchEvidence,
  quarantineLatestPropertyInspection,
  quarantineMismatchedPropertyInspections,
  restoreMatchingPropertyInspections,
  recoverableResearchMissionIds,
  researchConstraintsFor,
  verifyInspectionIdentity,
} from './opportunity-research-mission.js';
import {
  getLatestOpportunityReconciliation,
  ingestAndReconcileTranscript,
  listOpportunityReconciliationTasks,
  listOpportunityTranscripts,
} from './opportunity-transcript-reconciliation.js';
import { buildAcreageBasis, pinOverlayAcresToGeometry } from './acreage-basis.js';
import { acreageFactFromBasis, buildCanonicalDealState, reconcileFacts, type CanonicalDealState } from './deal-card-reconciliation.js';
import {
  compRegistryForDeal, retainedCompRunsFromReport, strategyReadinessForDeal, unifiedReadinessForDeal, documentRegistryForCard, modelVersionForCard,
  missionViewForCard, reconcileDealCard, compStateFromRegistry, DEAL_CARD_MODEL_VERSION,
  type ReportCompLanes,
} from './deal-card-canonical.js';
import { reconcilePersistedLandPortalEvidence } from './landportal-persisted-reconciliation.js';
import { isServableDocumentPage, type RegisteredDocument } from './document-registry.js';
import { recordDeedPage } from './recorded-deed-pages.js';
import { validateRecordedLienReview, type RecordedLienStatus } from './recorded-lien-review.js';
import { buildDdBusinessStatus } from './dd-business-status.js';
import { saveDocumentUpload, listDocumentUploads, updateDocumentUpload, removeDocumentUpload, servableUploadPath, UPLOAD_CATEGORIES } from './document-uploads.js';
import { interpretRetainedDealEvidence } from './deal-evidence-claims-store.js';
import type { DealEvidenceInterpretation } from './deal-evidence-claims.js';
import {
  RESOURCE_CATEGORIES,
  analyzeLeadCardIntake,
  findLeadCardIntakeBySubmissionKey,
  listLeadCardIntake,
  listPublicRecordOutcomes,
  listResourceContacts,
  persistLeadCardIntake,
  publicRecordSearchHierarchy,
  reconcileDealPersonIdentity,
  updateLeadCardIntakeCandidates,
  updateLeadCardIntakeResolution,
  upsertPublicRecordOutcome,
  upsertResourceContact,
  type PublicRecordOutcomeInput,
  type ResourceContactInput,
} from './lead-card-intake.js';
import { buildDevelopmentIntelligence } from './development-intelligence.js';
import {
  smartIntakeImageSha256,
  unavailableSmartIntakeImageExtraction,
  validateSmartIntakeImage,
  type SmartIntakeImageSourceMethod,
} from './smart-intake-image.js';
import {
  classifyIntakeArtifact,
  describeIntakeArtifact,
  extractIntakeArtifact,
} from './smart-intake-artifact.js';
import {
  dealEvidenceArtifacts,
  dealEvidenceSubmissionText,
  isTranscriptEvidence,
  prepareDealEvidence,
} from './deal-evidence-ingest.js';
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
import { landPortalValuationStats } from './landportal-valuation.js';
import type { DocumentRegistry } from './document-registry.js';
import { getOrBuildParcelOverlay, PARCEL_OVERLAY_KINDS, PARCEL_OVERLAY_LABELS, type ParcelOverlayKind } from './parcel-overlay-visuals.js';
import {
  getAcquisition, upsertSellerProfile, addCommLogEntry, addDiscoveryNote, setAcquisitionStage,
  updateCommLogEntry, deleteCommLogEntry,
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
import { collectBrowserMarketIntelligence, makeNewsResearchBackend, type GrowthDriverSummary } from './browser-market-intelligence.js';
import { googleVisualStatus, googleVisualConfiguredResolved } from './providers/google-visual.js';
import { isLeadType } from './db.js';
import { addComp, enrichCompCoordinates, listComps, recommendCompSources, evaluateCompRecency } from './comps.js';
import { buildCompsValuationView, setCompValuationSelection, resolveCompsValuationLocations, type CompSelectionAction } from './comps-valuation.js';
import { enrichRetainedCompListings } from './comp-listing-enrichment.js';
import { enrichCompTransactions } from './comp-transaction-enrichment.js';
import { reconcileCompGeography } from './comp-geography-reconciliation.js';
import { buildOfficialParcelGisView } from './official-parcel-gis-view.js';
import {
  TAX_STATUS_FIELDS, buildTaxStatusRead, taxAuthorityFor, taxStatusAttemptsFromSources,
} from './tax-status-research.js';
import { runOfficialParcelGis } from './official-parcel-gis-run.js';
import { buildLandUseView, buildRetainedLandUseIntelligenceView } from './land-use-view.js';
import { landPortalSetLabel } from './landportal-api.js';
import { runLandUseResearch } from './land-use-run.js';
import { buildPlatformCapabilityReport } from './gis-platform-registry.js';
import { listPlatformProofs } from './gis-platform-knowledge.js';
import { applyCompSourcePolicy } from './comp-source-policy.js';
import { buildCompLaneAccountability, type CompLaneInput, type CompLaneRouteOutcome } from './comp-lane-accountability.js';
import {
  buildExactAddressQueries,
  classifyDiscoveryResult,
  extractListingEvidence,
  projectExactAddressListingEvidence,
  EXACT_ADDRESS_LANE_ID,
  type ExtractedListingEvidence,
} from './exact-address-web-discovery.js';
import { loadSubjectListingDetail, reprojectSubjectListingDetail } from './subject-listing-store.js';
import { resolveCanonicalIdentity, supersessionLabel } from './canonical-identity.js';
import { resolveCanonicalSubjectState, unmetPrerequisites } from './canonical-subject-state.js';
import { candidateRowsFromPolicy, selectWorkingComps, workingSetToSnapshotComps } from './deal-intelligence-comps.js';
import type { CompRegistryCandidate, SubjectMarket } from './comp-registry.js';
import { persistPropertyInspection, runPropertyInspection } from './property-inspection.js';
import {
  runLandPortalBrowserUsePilot,
  browserUseRunStatus,
  markBrowserUseQueued,
  setBrowserUseRunState,
  subjectForDealCard,
  loadBrowserUseRunForDeal,
  hasPersistedBrowserUseCaptureForDeal,
  resolveBrowserUseCapturePath,
} from './landportal-browseruse.js';
import { runLandPortalStagedPilot, loadStagedRun } from './landportal-staged-pilot.js';

/** Staged pilot with the same operator-visible status surface as the agent path. */
async function runLandPortalStagedPilotTracked(dealCardId: number, provider: 'ollama' | 'google' | 'auto', captureLabels?: string[]): Promise<void> {
  setBrowserUseRunState(dealCardId, 'running');
  try {
    const outcome = await runLandPortalStagedPilot(dealCardId, provider, { captureLabels });
    if (outcome.error) setBrowserUseRunState(dealCardId, 'failed', outcome.error);
    else setBrowserUseRunState(dealCardId, outcome.ok ? 'completed' : 'failed', outcome.ok ? null : 'One or more stages failed; completed stages are persisted.');
  } catch (err) {
    setBrowserUseRunState(dealCardId, 'failed', err instanceof Error ? err.message : String(err));
  }
}

interface LandPortalSoilDetailProjection {
  symbol: string | null;
  name: string | null;
  fields: Record<string, string>;
}

/** Project deterministic direct-runner soil evidence into the existing
 * operator result surface. The direct runner intentionally persists cumulative
 * inspection evidence rather than creating a staged Browser Use run. */
function soilDetailsForDealCard(dealCardId: number): LandPortalSoilDetailProjection[] {
  const subjectCard = subjectForDealCard(dealCardId);
  if (!subjectCard) return [];
  const inspection = loadPropertyInspection(subjectCard.propertyCardId);
  const seen = new Set<string>();
  const details: LandPortalSoilDetailProjection[] = [];
  for (const evidence of inspection?.evidence ?? []) {
    if (evidence.source !== 'LandPortal Soil Type overlay popup') continue;
    try {
      const parsed = JSON.parse(evidence.detail) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object') continue;
      const name = typeof parsed.name === 'string' ? parsed.name : null;
      const symbol = typeof parsed.symbol === 'string' ? parsed.symbol : null;
      const fields = parsed.fields && typeof parsed.fields === 'object'
        ? Object.fromEntries(Object.entries(parsed.fields).filter(([, value]) => typeof value === 'string'))
        : {};
      if (!name && !symbol) continue;
      const identity = (name ?? symbol ?? '').trim().toLowerCase();
      if (!identity || seen.has(identity)) continue;
      seen.add(identity);
      details.push({ symbol, name, fields });
    } catch {
      // Historic evidence may contain a non-JSON detail; leave it visible in
      // the inspection record without manufacturing a structured soil row.
    }
  }
  return details;
}
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

function usableInspectionAsset(asset: { storedPath?: string | null }): boolean {
  if (!asset.storedPath) return false;
  try { return fs.statSync(asset.storedPath).isFile() && fs.statSync(asset.storedPath).size >= 8 * 1024; }
  catch { return false; }
}
// Browser sources sometimes render an unavailable field as "-".  This is not
// usable locality data and must never overwrite the owner-supplied city or
// leak into the visible Lead Card / map links.
const meaningfulStr = (v: unknown): string | undefined => {
  const value = str(v)?.trim();
  return value && !/^(?:-|--|n\/?a|not\s+(?:available|found)|unknown)$/i.test(value) ? value : undefined;
};
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** A stored address only counts as the property's address when it is not a
 *  LandOS placeholder handle for an unidentified lead. */
const nonPlaceholderAddress = (v: string | undefined | null): string | null =>
  (v && !isPlaceholderPropertyLabel(v) ? v : null);

function entityParam(raw: string | undefined): string | undefined {
  if (!raw || raw === 'all') return undefined;
  return (LANDOS_ENTITIES as readonly string[]).includes(raw) ? raw : undefined;
}

const PHASE1_DISPOSITIONS = new Set([
  'follow_up', 'nurture', 'dead_lead', 'wrong_property',
  'do_not_contact', 'duplicate', 'unlocatable',
]);

/** Begin the free, local research lane after the durable lead already exists.
 * WS2 records honest progressive state; the discovery workstream enriches the
 * same property/deal/opportunity graph. Failures remain visible and retryable. */
const scheduledResearchMissionIds = new Set<number>();
let researchMissionRecoveryScheduled = false;
// This is call-prep research, not a blocking deep-DD job. LandPortal and the
// county fallback run sequentially, so the inherited three-minute-per-lane
// ceiling could leave one lead looking hung for roughly six minutes.
const PHASE1_RESEARCH_LANE_TIMEOUT_MS = 45_000;

function scheduleResearchMission(missionId: number): void {
  if (scheduledResearchMissionIds.has(missionId)) return;
  scheduledResearchMissionIds.add(missionId);
  setTimeout(async () => {
    try {
      const mission = claimResearchMission(missionId);
      if (!mission) return;
      const opportunity = getOpportunity(mission.opportunityId);
      if (!opportunity) throw new Error(`opportunity ${mission.opportunityId} no longer exists`);
      const running = updateOpportunityResearchStatus(opportunity.id, 'running', {
        actor: 'property-research-agent',
        note: `Durable research mission ${mission.runKey} started (attempt ${mission.attempt}).`,
      });
      if (running.primaryPropertyCardId) {
        addCardNextAction({
          cardId: running.primaryPropertyCardId,
          action: 'Review available identity clues and prepare discovery questions; missing research does not block the call.',
          createdBy: 'property-research-agent',
        });
        attachCardActivity({
          cardId: running.primaryPropertyCardId,
          kind: 'phase1_research_started',
          summary: 'Automatic research started. Public/county and authenticated-browser evidence will progressively update this card.',
          agentId: 'property-research-agent',
        });
      }
      const profile = getLandosStorageProfile();
      if (profile.syntheticOnly || !running.legacyDealCardId || !running.primaryPropertyCardId) {
        const discoveryPackage = buildOpportunityDiscoveryPackage(opportunity.id, { persist: true, actor: 'property-research-agent' });
        updateOpportunityDiscoveryStatus(opportunity.id, 'brief_ready', {
          actor: 'property-research-agent',
          note: discoveryPackage.callPrep.ready
            ? 'Synthetic pre-call research report is decision-useful.'
            : 'Synthetic pre-call research is incomplete; identity-confirmation questions are available.',
        });
        updateOpportunityResearchStatus(opportunity.id, 'partial', {
          actor: 'property-research-agent',
          note: profile.syntheticOnly
            ? 'Synthetic QA lead is actionable; external research is intentionally isolated and retry remains available.'
            : 'Lead is actionable now; a subject property is still needed for external research.',
        });
        finishResearchMission(mission.id, {
          status: 'partial',
          summary: 'Synthetic or identity-incomplete lead remains actionable; external browser research was not promoted.',
          safeNextAction: 'Confirm the missing parcel identifier during discovery or retry after adding it.',
          verification: {
            accepted: false, identityState: 'unresolved', verdict: 'insufficient_identity',
            reasons: ['A real subject property was not available for external research.'],
            warnings: [],
            expected: mission.constraints, observed: { address: null, city: null, county: null, state: null, apn: null },
          },
          toolTrace: mission.toolTrace,
        });
        return;
      }
      const deal = getDealCard(running.legacyDealCardId);
      const prop = (deal?.propertyCards?.[0] ?? {}) as {
        active_input_address?: string | null; apn?: string | null; county?: string | null;
        state?: string | null; city?: string | null; owner?: string | null; fips?: string | null;
        acres?: number | null; verification_status?: string | null; verification_source?: string | null;
      };

      // Fresh manual leads commonly arrive with ZIP but no county. Reuse the
      // retained LandPortal market geography membership when it resolves the
      // ZIP to exactly one county. This scopes the public/county lane before it
      // runs and remains locality context only; the parcel still has to pass the
      // immutable address/APN identity gate below.
      const intakeZip = extractZipCandidate(opportunity.rawInput)
        ?? extractZipCandidate(str(prop.active_input_address));
      const storedCounty = resolveCountyRefByZip(intakeZip, mission.constraints.state ?? str(prop.state));
      // A lead with a street address, city and state but NO ZIP had no county
      // path at all: the ZIP lane above was the only one, so the county stayed
      // empty, the jurisdiction filters were never scoped, and every official
      // parcel adapter (which is selected BY county) was inapplicable. Derive
      // the administrative county from the free, keyless Census geocoder.
      //
      // This is SUPPORTING GEOGRAPHY used to scope an exact lookup — it is
      // never parcel identity, never a boundary, and never a verification
      // source. The identity gate below is unchanged.
      const derivationState = mission.constraints.state ?? meaningfulStr(prop.state);
      const derivationAddress = mission.constraints.address ?? meaningfulStr(prop.active_input_address);
      const needsCountyDerivation = !mission.constraints.county
        && !meaningfulStr(prop.county)
        && !storedCounty
        && !!derivationAddress
        && !!derivationState;
      const derivedCounty = needsCountyDerivation
        ? await deriveCounty({
          address: derivationAddress,
          city: mission.constraints.city ?? meaningfulStr(prop.city),
          state: derivationState,
          zip: intakeZip ?? undefined,
        }).catch(() => null)
        : null;
      const countyDerivationTrace: Array<Record<string, unknown>> = [];
      if (needsCountyDerivation) {
        countyDerivationTrace.push({
          provider: 'US Census geocoder',
          stage: 'county_derivation',
          status: derivedCounty ? 'derived' : 'no_match',
          url: null,
          note: derivedCounty
            ? `Derived administrative county "${derivedCounty.county}" (FIPS ${derivedCounty.fips ?? 'n/a'}) for ${derivationAddress}, ${derivationState}. Supporting geography used to scope official lookups; it is not parcel identity and confirms nothing about the parcel.`
            : `The Census geocoder returned no county for ${derivationAddress}, ${derivationState}. The county remains unknown, so county-scoped official parcel sources cannot be selected.`,
        });
      }
      const scopedCounty = mission.constraints.county
        ?? meaningfulStr(prop.county)
        ?? storedCounty?.countyName
        ?? derivedCounty?.county
        ?? undefined;
      const scopedState = mission.constraints.state
        ?? meaningfulStr(prop.state)
        ?? storedCounty?.state
        ?? derivedCounty?.state
        ?? undefined;
      const scopedFips = storedCounty?.fips ?? derivedCounty?.fips ?? undefined;
      if ((storedCounty || derivedCounty) && (!meaningfulStr(prop.county) || !meaningfulStr(prop.fips))) {
        upsertPropertyCard({
          entity: running.entity,
          cardId: running.primaryPropertyCardId,
          activeInputAddress: mission.constraints.address ?? str(prop.active_input_address) ?? running.title,
          city: mission.constraints.city ?? meaningfulStr(prop.city),
          county: scopedCounty,
          state: scopedState,
          fips: scopedFips,
          apn: meaningfulStr(prop.apn),
          owner: meaningfulStr(prop.owner),
          acres: typeof prop.acres === 'number' && prop.acres > 0 ? prop.acres : undefined,
          verified: prop.verification_status === 'verified_property',
          verificationSource: meaningfulStr(prop.verification_source),
          agentId: 'property-research-agent',
        });
        if (derivedCounty) {
          attachCardActivity({
            cardId: running.primaryPropertyCardId,
            kind: 'county_derived',
            agentId: 'property-research-agent',
            summary: `Administrative county derived as ${derivedCounty.county}${derivedCounty.fips ? ` (FIPS ${derivedCounty.fips})` : ''} from the US Census geocoder. Supporting geography only — it scopes official lookups and asserts nothing about the parcel.`,
          });
        }
      }
      // First quarantine any previously retained inspection that conflicts with
      // the immutable operator constraints. Nothing is deleted.
      const priorQuarantines = quarantineMismatchedPropertyInspections(
        running.id, running.primaryPropertyCardId, mission.constraints,
      );
      // A lead-card retry is the normal operator path for parcel research.  A
      // bare browser session is not enough: it leaves the authenticated
      // LandPortal lane unavailable even when the existing, safely-loaded
      // environment credentials are configured.  Ensure the shared session is
      // signed in here; the helper retains credentials inside the process and
      // returns only readiness metadata.  Public/county inspection remains
      // available if that optional source cannot be reached.
      await ensureLandPortalAuthenticated();
      const result = await runPropertyInspection({
        cardId: running.primaryPropertyCardId,
        searchKey: {
          address: mission.constraints.address ?? undefined,
          apn: mission.constraints.apn ?? undefined,
          county: scopedCounty,
          state: scopedState,
          city: mission.constraints.city ?? undefined,
          owner: str(prop.owner ?? undefined),
        },
        mode: 'deep_record',
        timeoutMs: PHASE1_RESEARCH_LANE_TIMEOUT_MS,
      }, {
        landPortalBrowser: makeLandPortalBrowser({ driver: makeLiveBrowserDriver('landportal') }),
        countyRecordsBrowser: makeCountyRecordsBrowser({ driver: makeLiveBrowserDriver('county_records') }),
        googleVisualConfigured: googleVisualConfiguredResolved(),
      });
      persistPropertyInspection(running.primaryPropertyCardId, result.inspection);
      const verification = verifyInspectionIdentity(mission.constraints, result.inspection);
      const toolTrace = [...mission.toolTrace, ...countyDerivationTrace, ...result.routes.map((route) => ({
        provider: route.provider, stage: route.stage, status: route.status,
        confidence: route.confidence, url: route.url ?? null, note: route.note,
      }))];
      if (!verification.accepted) {
        quarantineLatestPropertyInspection(running.id, running.primaryPropertyCardId, verification);
        const discoveryPackage = buildOpportunityDiscoveryPackage(opportunity.id, { persist: true, actor: 'property-research-agent' });
        // Name the ACTUAL blocker. "Confirm the parcel" is not an action when
        // the reason nothing resolved is that LandOS could not determine the
        // county, or has no official source configured for the one it did.
        const coverage = officialParcelSourceCoverage({
          address: mission.constraints.address ?? undefined,
          county: scopedCounty,
          state: scopedState,
          apn: mission.constraints.apn ?? undefined,
        });
        // A failed county derivation is decision-relevant even when a statewide
        // source did apply: the lookup ran unscoped, which is why a street-name
        // match can come back ambiguous.
        const countyGap = needsCountyDerivation && !derivedCounty
          ? ' The county could not be derived from the street address, so the lookup could not be scoped to one jurisdiction.'
          : '';
        const escalation = coverage.available
          ? `${discoveryPackage.callPrep.nextResearchActions[0] ?? 'Confirm the parcel/APN and retry research.'}${countyGap}`
          : `${coverage.reason}${countyGap} Supply the APN (or the county, if unknown) on this card and re-run research, or ask the seller for the parcel number from their tax bill or deed.`;
        updateOpportunityDiscoveryStatus(opportunity.id, 'brief_ready', {
          actor: 'property-research-agent',
          note: 'Pre-call research is incomplete: conflicting parcel evidence was quarantined and identity questions are available.',
        });
        updateOpportunityResearchStatus(opportunity.id, 'partial', {
          actor: 'property-research-agent',
          note: `Wrong or insufficient parcel evidence was quarantined: ${verification.reasons.join('; ')}`,
        });
        finishResearchMission(mission.id, {
          status: 'quarantined',
          summary: `No parcel evidence was promoted. ${verification.reasons.join('; ')}${coverage.available ? '' : ` ${coverage.reason}`}`,
          safeNextAction: escalation,
          verification, toolTrace,
        });
        attachCardActivity({
          cardId: running.primaryPropertyCardId, kind: 'phase1_research_quarantined', agentId: 'property-research-agent',
          summary: `Research mission quarantined wrong-property evidence: ${verification.reasons.join('; ')}`,
          ref: JSON.stringify({ missionId: mission.id, verification, priorQuarantinedActivityIds: priorQuarantines.map((row) => row.activityId) }),
        });
        return;
      }
      const isCandidate = verification.identityState === 'candidate';
      const observedFacts = result.inspection.parcelFacts;
      const observedApn = meaningfulStr(observedFacts['Parcel ID'] ?? observedFacts.APN);
      const observedCounty = meaningfulStr(observedFacts['Parcel Address County'] ?? observedFacts.County) ?? scopedCounty;
      const observedState = meaningfulStr(observedFacts['Parcel Address State'] ?? observedFacts.State) ?? scopedState;
      const observedCity = meaningfulStr(observedFacts['Parcel Address City'] ?? observedFacts.City) ?? mission.constraints.city ?? undefined;
      const observedOwner = meaningfulStr(observedFacts['Owner Name']);
      const statedAcres = Number(meaningfulStr(observedFacts.Acres));
      const calculatedAcres = Number(meaningfulStr(observedFacts['Calc Acres']));
      const observedAcres = Number.isFinite(statedAcres) && statedAcres > 0 ? statedAcres : calculatedAcres;
      const { card: acceptedPropertyCard } = upsertPropertyCard({
        entity: running.entity, cardId: running.primaryPropertyCardId,
        activeInputAddress: mission.constraints.address ?? str(prop.active_input_address) ?? running.title,
        city: observedCity, county: observedCounty, state: observedState, apn: observedApn,
        fips: meaningfulStr(prop.fips) ?? storedCounty?.fips,
        owner: observedOwner, acres: Number.isFinite(observedAcres) && observedAcres > 0 ? observedAcres : undefined,
        verified: !isCandidate,
        verificationSource: isCandidate
          ? `Candidate parcel — APN + county + state match; address discrepancy flagged: ${verification.warnings.join('; ')}`
          : 'LandPortal authenticated browser',
        summary: isCandidate
          ? 'Parcel identity is a candidate (APN + county + state match; address discrepancy requires official county verification).'
          : 'Parcel identity verified against immutable operator jurisdiction constraints.',
        agentId: 'property-research-agent',
      });
      // Once the subject has passed the immutable identity gate, continue the
      // same operator-requested mission into the read-only Zillow/Redfin browser
      // fallback.  Previously this only happened from the separate Deal Library
      // report action, leaving a Lead Card research retry with no marketplace
      // work at all.  The report path persists returned rows into the shared
      // comp registry and retains site-specific blockers when a site refuses
      // automation; no paid LandPortal workflow is involved.
      const marketTrace: Array<Record<string, unknown>> = [];
      try {
        if (isCandidate) {
          marketTrace.push({
            provider: 'Zillow / Redfin browser', stage: 'comparable_market', status: 'not_attempted',
            note: 'Marketplace research remains blocked until Property Resolution establishes one canonical parcel.',
          });
        } else {
        const marketRun = await runDealCardReport(running.legacyDealCardId, {
          resolve: buildPersistedResolver(acceptedPropertyCard as unknown as Record<string, unknown>),
          timeoutMs: PHASE1_RESEARCH_LANE_TIMEOUT_MS,
          actor: 'property-research-agent',
          compResearchDriver: makeLiveBrowserDriver('market_research'),
        });
        const research = (marketRun?.report.marketComps as unknown as {
          research?: { attempts?: Array<{ source?: string; outcome?: string; note?: string; url?: string | null; compCount?: number }> };
        } | undefined)?.research;
        for (const attempt of research?.attempts ?? []) {
          marketTrace.push({
            provider: attempt.source === 'zillow' ? 'Zillow' : attempt.source === 'redfin' ? 'Redfin' : 'Marketplace browser',
            stage: 'comparable_market', status: attempt.outcome ?? 'unknown', url: attempt.url ?? null,
            note: `${attempt.compCount ?? 0} visible row(s). ${attempt.note ?? ''}`.trim(),
          });
        }
        if (!research?.attempts?.length) {
          marketTrace.push({ provider: 'Zillow / Redfin browser', stage: 'comparable_market', status: 'not_attempted', note: 'No browser marketplace attempt was returned by the report workflow.' });
        }
        }
      } catch (error) {
        marketTrace.push({ provider: 'Zillow / Redfin browser', stage: 'comparable_market', status: 'error', note: error instanceof Error ? error.message : 'Marketplace browser research failed before results could be returned.' });
      }
      const discoveryPackage = buildOpportunityDiscoveryPackage(opportunity.id, { persist: true, actor: 'property-research-agent' });
      updateOpportunityDiscoveryStatus(opportunity.id, 'brief_ready', {
        actor: 'property-research-agent',
        note: discoveryPackage.callPrep.ready
          ? 'Pre-call research report is decision-useful.'
          : 'Pre-call research remains incomplete; discovery questions are available.',
      });
      const usefulEvidence = Object.keys(result.inspection.parcelFacts).length > 0
        || result.inspection.assets.length > 0
        || (result.inspection.evidence?.length ?? 0) > 0;
      const failures = result.routes.filter((route) => route.status === 'error');
      const discrepancyNote = isCandidate
        ? ` Address discrepancy: ${verification.warnings.join('; ')}. Official county verification recommended.`
        : '';
      updateOpportunityResearchStatus(opportunity.id, usefulEvidence && failures.length === 0 && !isCandidate ? 'complete' : 'partial', {
        actor: 'property-research-agent',
        note: usefulEvidence
          ? `Research captured best-available evidence${failures.length ? `; ${failures.map((route) => route.provider).join(', ')} failed and can be retried` : ''}.${discrepancyNote}`
          : `No parcel evidence was captured; ${failures.map((route) => route.provider).join(', ') || 'providers'} remain retryable.`,
      });
      finishResearchMission(mission.id, {
        status: usefulEvidence && failures.length === 0 && !isCandidate ? 'complete' : 'partial',
        summary: usefulEvidence
          ? (isCandidate ? 'Candidate parcel evidence was promoted with address discrepancy flagged.' : 'Verified parcel-associated research was promoted to the shared Lead Card.')
          : 'No useful verified evidence was captured.',
        safeNextAction: isCandidate
          ? `Verify the official situs address with ${mission.constraints.county} County ${mission.constraints.state} records. ${discoveryPackage.callPrep.nextResearchActions[0] ?? ''}`.trim()
          : discoveryPackage.callPrep.nextResearchActions[0] ?? 'Review the verified research package before the discovery call.',
        verification,
        toolTrace: [...toolTrace, ...marketTrace, {
          stage: 'learning_promotion', status: 'accepted',
          note: 'Research outcome was promoted only after subject-parcel identity verification. Site-navigation mechanics remain separate from parcel facts.',
        }],
      });
    } catch (error) {
      try {
        const mission = getResearchMission(missionId);
        if (mission) failResearchMission(missionId, error instanceof Error ? error.message : 'Research mission failed.');
        if (mission) updateOpportunityResearchStatus(mission.opportunityId, 'failed', {
          actor: 'property-research-agent',
          note: error instanceof Error ? error.message : 'Research worker failed; retry is available.',
        });
      } catch {
        // The durable lead remains intact even if status recording also fails.
      }
    } finally {
      scheduledResearchMissionIds.delete(missionId);
    }
  }, 0);
}

function queuePhase1Research(opportunity: OpportunityRecord, trigger = 'automatic_intake'): void {
  const property = opportunity.primaryPropertyCardId
    ? (getPropertyCardRow(opportunity.primaryPropertyCardId) as Record<string, unknown> | undefined)
    : undefined;
  const constraints = researchConstraintsFor(opportunity, property);
  const mission = createResearchMission(opportunity, constraints, trigger);
  scheduleResearchMission(mission.id);
}

/**
 * Legacy Phase-1 missions predate the runtime Capability contract. They cannot
 * be safely resumed because doing so would start a second authoritative parcel
 * resolver beside Deal Intelligence. Startup closes them durably with an exact
 * operator next action; the Deal Card remains intact and its normal refresh
 * control starts the capability-rooted path.
 */
export function supersedeRecoverableLegacyResearchMissions(): number[] {
  const superseded: number[] = [];
  for (const missionId of recoverableResearchMissionIds()) {
    const mission = getResearchMission(missionId);
    if (!mission) continue;
    failResearchMission(missionId, 'Superseded by the Property Resolution Capability root; legacy provider fanout was not resumed.');
    getLandosDb().prepare(`
      UPDATE landos_opportunity_research_mission
      SET summary = ?, safe_next_action = ?, updated_at = unixepoch()
      WHERE id = ?
    `).run(
      'Legacy research was safely superseded without running its resolver or providers.',
      'Open the Deal Card and refresh Property Resolution to start the canonical capability-rooted workflow.',
      missionId,
    );
    const opportunity = getOpportunity(mission.opportunityId);
    if (opportunity && opportunity.researchStatus !== 'complete') {
      updateOpportunityResearchStatus(mission.opportunityId, 'partial', {
        actor: 'property-resolution-capability-migration',
        note: 'A recoverable legacy research mission was superseded without provider fanout. Use the Deal Card Property Resolution refresh.',
      });
    }
    superseded.push(missionId);
  }
  return superseded;
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
interface PublicCompLocation {
  address?: string; city?: string; state?: string; zip?: string; county?: string;
  apn?: string; owner?: string;
  lat?: number; lng?: number; subjectAcres?: number | null;
}

function persistGrowthSummary(cardId: number | null, summary: GrowthDriverSummary & { readBy?: 'llm' | 'keyword' }): void {
  if (!cardId) return;
  attachCardActivity({
    cardId,
    agentId: 'market-intelligence',
    kind: 'market_pulse_synthesis',
    summary: `Market Pulse synthesis saved (${summary.drivers.length} driver group(s), ${summary.evidenceCount} source item(s), read by ${summary.readBy ?? 'deterministic synthesis'}).`,
    ref: JSON.stringify(summary),
  });
}

function loadGrowthSummary(cardId: number | null): (GrowthDriverSummary & { readBy?: 'llm' | 'keyword' }) | null {
  if (!cardId) return null;
  const row = getLandosDb().prepare(`SELECT ref FROM landos_card_activity
    WHERE card_id = ? AND kind = 'market_pulse_synthesis' AND ref <> ''
    ORDER BY created_at DESC, id DESC LIMIT 1`).get(cardId) as { ref: string } | undefined;
  if (!row?.ref) return null;
  try {
    const parsed = JSON.parse(row.ref) as GrowthDriverSummary & { readBy?: 'llm' | 'keyword' };
    return parsed && Array.isArray(parsed.drivers) && typeof parsed.summary === 'string' ? parsed : null;
  } catch { return null; }
}

function mergeStoredBrowserFacts(report: ReturnType<typeof getDealCardReport>, dealCardId: number) {
  const facts = listBrowserFacts(dealCardId).filter((fact) => fact.status === 'extracted' && fact.value.trim() && !/Link$/i.test(fact.key));
  const rows = new Map((report.ddFactChecklist ?? []).map((row) => [row.key, row]));
  for (const fact of facts) {
    const key = /^utilities?$/i.test(fact.key) ? 'utility_summary' : fact.key;
    const official = fact.confidence === 'high' && /assessor|tax|gis|recorder|county|state/i.test(`${fact.sourceType} ${fact.sourceName}`);
    const existing = rows.get(key);
    if (existing?.status === 'verified' && !official) continue;
    rows.set(key, {
      key,
      label: fact.label || fact.key,
      value: fact.value,
      status: official ? 'verified' : 'needs_verification',
      source: fact.sourceName || fact.sourceType || null,
      noConnectedSource: false,
    });
  }
  const inspection = report.landportalInspection?.factSheet;
  const put = (key: string, label: string, value: string | null | undefined, source: string, verified = false) => {
    if (!value?.trim()) return;
    rows.set(key, { key, label, value: value.trim(), status: verified ? 'verified' : 'needs_verification', source, noConnectedSource: false });
  };
  if (inspection) {
    put('roadFrontageFt', 'Road frontage', inspection.access.roadFrontageFt == null ? null : `~${inspection.access.roadFrontageFt} ft (screening; legal frontage not established)`, 'LandPortal');
    put('landLocked', 'Access', inspection.access.label, 'LandPortal');
    put('buildabilityPct', 'Buildability', inspection.buildability.label, 'LandPortal');
    put('buildableAcres', 'Buildable acres', inspection.buildability.acres, 'LandPortal');
  }
  const officialLandUse = facts.find((fact) => fact.key === 'officialLandUse');
  if (officialLandUse) put('landUse', 'Land use', officialLandUse.value, officialLandUse.sourceName, true);
  const utilityFact = facts.find((fact) => fact.key === 'officialGeometryAccess');
  const utilitySummary = utilityFact?.value.match(/utilities:\s*([^;]+)/i)?.[1]?.trim();
  if (utilityFact && utilitySummary) put('utility_summary', 'Utilities (assessor record)', `${utilitySummary}; confirm actual service at the parcel`, utilityFact.sourceName);
  report.ddFactChecklist = [...rows.values()];
  const verified = report.ddFactChecklist.filter((row) => row.status === 'verified').length;
  const total = report.ddFactChecklist.length;
  report.ddCompleteness = {
    total, verified, needsVerification: total - verified,
    percentComplete: total ? Math.round((verified / total) * 100) : 0,
    label: `${verified}/${total} source-supported facts`,
  };
  return facts;
}

function recordedEvidenceFromBrowserFacts(facts: ReturnType<typeof listBrowserFacts>) {
  return facts
    .filter((fact) => /deed|easement|legal description|last sale|book|instrument/i.test(`${fact.key} ${fact.label}`))
    .map((fact) => ({
      fact: fact.label || fact.key,
      sourceUrl: fact.sourceUrl,
      sourceType: fact.sourceType,
      dateAccessed: new Date(fact.createdAt * 1000).toISOString(),
      note: `${fact.value}. Metadata only unless a recorded instrument image is present; easement terms are not inferred.`,
    }));
}

/** Complete subject geography for self-correcting marketplace searches. */
function publicLocalityFallback(dealCardId: number, input: PublicCompLocation): PublicCompLocation {
  try {
    const stored = new PublicIntelligenceStore().load(dealCardId);
    const run = stored?.run;
    const finding = run?.tasks?.find((task) => task.task === 'county_records')?.finding;
    if (!finding || finding.kind !== 'county_records') return input;
    const fact = (field: string) => {
      const row = finding.facts.find((entry) => entry.field === field);
      return row != null ? String(row.value) : undefined;
    };
    const censusLocality = fact('Situs locality (Census county subdivision)');
    const usablePlace = (value?: string) => value && !/\b(?:district|township|division|precinct|county)\b/i.test(value) ? value : undefined;
    const locality = usablePlace(input.city) ?? usablePlace(censusLocality);
    const state = finding.jurisdiction?.split(',').pop()?.trim();
    const county = input.county ?? finding.jurisdiction?.split(',')[0]?.replace(/\s+County$/i, '').trim();
    const ring = stored?.orchestration?.subjectGeometry?.rings?.[0] ?? [];
    const validPoints = ring.map((point) => ({ lng: Number(point[0]), lat: Number(point[1]) })).filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
    const centroid = validPoints.length ? {
      lng: validPoints.reduce((sum, point) => sum + point.lng, 0) / validPoints.length,
      lat: validPoints.reduce((sum, point) => sum + point.lat, 0) / validPoints.length,
    } : null;
    return {
      ...input,
      address: input.address ?? fact('Situs address'),
      city: locality,
      state: input.state ?? state,
      zip: input.zip ?? fact('Situs ZIP (Census ZCTA)'),
      county,
      lat: input.lat ?? centroid?.lat,
      lng: input.lng ?? centroid?.lng,
    };
  } catch {
    return input;
  }
}

/** Rehydrate the last official public parcel match into the report runner's
 * verification contract. This is an identity handoff, never a new lookup and
 * never a coordinate/proximity match. */
export function verificationFromStoredPublicIntelligence(stored: StoredPublicIntelligenceRun | null): DukeVerificationResult | undefined {
  if (!stored || stored.parcelKey.startsWith('unresolved:')) return undefined;
  const task = stored.run.tasks.find((row) => row.task === 'county_records');
  if (task?.status !== 'succeeded' || task.finding?.kind !== 'county_records') return undefined;
  const source = task.evidence.find((item) => item.sourceTier === 'official_county_state' && !!item.sourceName?.trim());
  if (!source) return undefined;
  const fact = (field: string): string | undefined => {
    const row = task.finding?.kind === 'county_records'
      ? task.finding.facts.find((entry) => entry.field === field)
      : undefined;
    return row == null ? undefined : String(row.value).trim() || undefined;
  };
  const apn = fact('APN') ?? stored.parcelKey;
  const situsAddress = fact('Situs address');
  const situsParts = (situsAddress ?? '').split(',').map((part) => part.trim()).filter(Boolean);
  const situsCity = situsAddress && !/^APN\b/i.test(situsAddress) && situsParts.length >= 3
    ? situsParts[1]
    : undefined;
  const jurisdiction = task.finding.jurisdiction ?? '';
  const state = jurisdiction.split(',').pop()?.trim() || undefined;
  const county = jurisdiction.split(',')[0]?.replace(/\s+County$/i, '').trim() || undefined;
  if (!apn || !county || !state) return undefined;
  const acresValue = Number(fact('Assessed acreage'));
  const ring = stored.orchestration?.subjectGeometry?.rings?.[0] ?? [];
  const coordinates = ring.length
    ? {
        lng: ring.reduce((sum, point) => sum + Number(point[0]), 0) / ring.length,
        lat: ring.reduce((sum, point) => sum + Number(point[1]), 0) / ring.length,
      }
    : undefined;
  return {
    status: 'parcel_verified',
    parcelVerified: true,
    verificationSource: source.sourceName,
    identity: {
      apn,
      situsAddress,
      // County subdivisions are supporting geography and can disagree with
      // the parcel's actual mailing city/CDP. Promote only a city parsed from
      // the official situs address; otherwise preserve the existing card city.
      city: situsCity,
      county,
      state,
      owner: fact('Owner of record'),
      acres: Number.isFinite(acresValue) && acresValue > 0 ? acresValue : undefined,
    },
    coordinates,
    sourceAttempts: [{ source: source.sourceName, status: 'verified', reason: 'Reused the persisted official public parcel record.', truthLabel: 'verified_fact' }],
    dataGaps: [],
    marketPulseEligible: true,
    strategyUnderwritingBlocked: false,
    summary: `Parcel identity verified by ${source.sourceName}.`,
    executionMode: 'duke_verification_read_only',
  };
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
  /** Current V2 accepted valuation set, distinct from the larger retained comp
   * registry rendered for evidence review. */
  currentCompsValuation?: ReturnType<typeof buildCompsValuationView>;
}): string {
  const { deal, report, executiveSummary, discoveryReport, briefing, unifiedReadiness, strategyReadiness, compRegistry, currentCompsValuation } = input;
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
    if (currentCompsValuation) {
      lines.push(`Accepted valuation set: ${currentCompsValuation.summary.acceptedCount} closed sale${currentCompsValuation.summary.acceptedCount === 1 ? '' : 's'}; the larger registry remains visible as retained evidence, not as FMV inputs.`);
    }
  } else {
    if (comps.length === 0) lines.push('No comparable rows were extracted in the current run.');
    for (const c of comps.slice(0, 20) as Array<Record<string, unknown>>) {
      lines.push(`- ${fmtText(c.status, 'unknown')}${c.address ? ` | ${c.address}` : ''}${c.apn ? ` | APN ${c.apn}` : ''}${c.acres ? ` | ${c.acres} ac` : ''}${c.price ? ` | ${fmtMoney(c.price)}` : ''}${c.pricePerAcre ? ` | ${fmtMoney(c.pricePerAcre)}/ac` : ''}${c.distanceMiles ? ` | ${c.distanceMiles} mi` : ''}`);
    }
  }
  lines.push('');
  lines.push(`## Valuation`);
  if (report.valuation?.primary?.value != null) {
    lines.push(`- Supported fair market value: ${fmtMoney(report.valuation.primary.value)}`);
    lines.push(`- Basis: ${report.valuation.primary.label}. ${report.valuation.primary.note}`);
    lines.push(`- Confidence: ${report.valuation.confidence}`);
    if (report.valuation.valueRange) {
      lines.push(`- Supported range: ${fmtMoney(report.valuation.valueRange.low)}–${fmtMoney(report.valuation.valueRange.high)}`);
    }
  } else {
    lines.push(`No supported fair market value is available from current accepted evidence.${report.valuation?.nextAction ? ` ${report.valuation.nextAction}` : ''}`);
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

/** Operator-facing browser evidence: status, provenance-labeled facts, the
 *  official sources routed, and a clean note — never a raw log/field dump. */
function redactEvidence(ev: { service: string; mode: string; status: string; facts: unknown[]; sourcesUsed: unknown[]; screenshots: unknown[]; blocked: unknown[]; note: string }): Record<string, unknown> {
  return {
    service: ev.service, mode: ev.mode, status: ev.status,
    facts: ev.facts, sourcesUsed: ev.sourcesUsed,
    screenshotCount: ev.screenshots.length, blocked: ev.blocked, note: ev.note,
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

/** Serialize any live-browser-driving mission through the single-tab gate.
 *  Later calls queue instead of colliding; a failed mission never poisons the
 *  queue. Shared by parallel resolution AND every resolveProperty call whose
 *  deps include a live browser lane. */
function withBrowserMissionGate<T>(run: () => Promise<T>): Promise<T> {
  const result = parallelResolutionGate.then(run, run);
  parallelResolutionGate = result.catch(() => undefined);
  return result;
}

/**
 * Hand the subject over the moment the parcel's own facts are read.
 *
 * The identity lane needs those facts and nothing else, and the direct API path
 * has them within seconds. It used to wait for the whole inspection — imagery,
 * overlays, 3D, county deep record — and report a handoff timeout for data it
 * had been holding since second 36. This persists the facts as soon as they are
 * read and tells the lane; the inspection itself is untouched and still persists
 * everything it produces when it finishes.
 *
 * IDENTITY GATE: this fires ONLY when the capture read the retained URL it was
 * aimed at. It retains facts and wakes the capability lane, but never binds or
 * promotes the URL; the next capability-owned beforeResolve transition does so
 * under the shared subject lock.
 */
export function landPortalSubjectFactsHandoff(input: {
  cardId: number;
  dealCardId: number | null;
  retainedUrl: string | null;
  onSubjectReady?: (capture: { ok: boolean; note: string; comparableCount: number }) => void;
}): ((payload: { url: string; fields: Record<string, string>; verifiedParcelApn?: string | null }) => void) | undefined {
  const { cardId, dealCardId, retainedUrl, onSubjectReady } = input;
  const retainedIdentity = retainedUrl ? landPortalIdentityFromUrl(retainedUrl) : null;
  // An OPERATOR entry link (a saved map) carries no decodable parcel identity,
  // so the identity comparison below cannot be the guard for it. Requiring one
  // meant no handoff hook was created at all, and a run that opened the parcel
  // directly still waited out the whole capture. The equivalent guarantee for
  // this shape is that the facts came back from the exact URL we opened, and
  // that the record itself names a parcel — which is what actually establishes
  // identity here. The link remains an entry point and never a fact.
  const entryOnlyUrl = !retainedIdentity && isOperatorEntryOnlyLandPortalUrl(retainedUrl) ? retainedUrl : null;
  if (!retainedUrl || (!retainedIdentity && !entryOnlyUrl) || !onSubjectReady) return undefined;
  let handedOff = false;
  return ({ url, fields, verifiedParcelApn }) => {
    if (handedOff) return;
    if (entryOnlyUrl) {
      const namesParcel = Object.entries(fields)
        .some(([key, value]) => /^(?:parcel id|parcel number|apn)$/i.test(key) && String(value ?? '').trim());
      if (url !== entryOnlyUrl || !namesParcel) {
        logger.warn({ event: 'landportal_subject_handoff_entry_url_unverified', cardId }, 'landportal_subject_handoff_entry_url_unverified');
        return;
      }
    } else if (!sameLandPortalParcel(landPortalIdentityFromUrl(url), retainedIdentity)) {
      logger.warn({ event: 'landportal_subject_handoff_parcel_mismatch', cardId }, 'landportal_subject_handoff_parcel_mismatch');
      return;
    }
    const factCount = Object.values(fields).filter((value) => String(value ?? '').trim()).length;
    if (!factCount) return;
    handedOff = true;
    // Cumulative, non-destructive: the same merge every other inspection write
    // uses. No assets are claimed here — the capture still owns them.
    //
    // The verification this run performed is written down WITH the facts. The
    // run that opens and confirms the parcel is the run that should be able to
    // admit it; recording the verdict only when the full capture finished meant
    // admission read an unverified record and the subject resolved one
    // invocation late. Same record shape everything already reads — the entry
    // URL stays a route, so no fips or property id is claimed for it and the
    // APN written is the one the opened record stated.
    const verifiedEntryRecord = entryOnlyUrl && verifiedParcelApn
      ? {
        url: entryOnlyUrl,
        source: 'operator:landportal_entry_url_verified_on_screen',
        capturedAt: new Date().toISOString(),
        propertyCardId: cardId,
        dealCardId,
        verifiedSubject: true,
        apn: verifiedParcelApn,
        fips: null,
        propertyId: null,
      }
      : null;
    persistPropertyInspection(cardId, {
      parcelUrl: retainedUrl,
      ...(verifiedEntryRecord ? { parcelUrlRecord: verifiedEntryRecord } : {}),
      comparablesUrl: null,
      parcelFacts: fields,
      assets: [], overlays: [], visualObservations: [], comparables: [],
    });
    logger.info({ event: 'landportal_subject_facts_handed_off', cardId, factCount }, 'landportal_subject_facts_handed_off');
    onSubjectReady({
      ok: true,
      comparableCount: 0,
      note: `Verified subject parcel facts (${factCount} field(s)) read from the retained LandPortal parcel record. Visual and deep-record capture continues in the background and lands its evidence when it finishes.`,
    });
  };
}

/**
 * Apply a parallel-resolution verdict to a card: record the attempt + every
 * hard reconciliation issue, and either PROMOTE a previously unresolved lead to
 * a confirmed parcel or — when the verdict contradicts an already-ACCEPTED
 * APN — preserve the accepted record, record the contradiction, and route it to
 * Tyler (operator-confirmation rule). Shared by the manual endpoint and the
 * autonomous acquire/run escalation so both behave identically.
 */
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
  if (!researchMissionRecoveryScheduled) {
    researchMissionRecoveryScheduled = true;
    setTimeout(() => {
      supersedeRecoverableLegacyResearchMissions();
      // Startup reconciliation: a Deal Card confirmed by an older code path may
      // have an accepted parcel identity with no versioned Property Summary,
      // which made one panel say "confirmed 1.00" while another said the parcel
      // was unverified and the pipeline was locked. Reconcile once at start so
      // no GET ever has to write to make the card consistent.
      try { reconcileAllPendingCanonicalIdentities(); } catch { /* recovery never blocks startup */ }

      // RECLAIM TABS STRANDED BY A PREVIOUS LANDOS PROCESS.
      //
      // The automation Chrome outlives this runtime on purpose — LandPortal
      // auth lives in its profile — so every restart leaves the last process's
      // tabs (above all the cached LandPortal working tab) open with nothing
      // left alive that knows it owned them. In-process cleanup can never see
      // them, and they accumulated a restart at a time until an operator ran
      // `npm run landos:browser reap` by hand.
      //
      // This is the one boundary where closing every page is provably correct:
      // nothing in this process owns a tab yet, and the runtime PID lock means
      // no other LandOS is running. The ownership guard still refuses anything
      // that is not the LandOS profile, so the operator's Chrome is untouched.
      if (process.env.NODE_ENV !== 'test') {
        void reclaimStrandedAutomationTabs({
          dashboardOrigin: `http://localhost:${process.env.PORT ?? 3141}`,
        }).then((reclaim) => {
          if (reclaim.ran && reclaim.closed > 0) {
            logger.info({ closed: reclaim.closed, remaining: reclaim.remaining }, 'automation_browser_startup_reclaim');
          }
        }).catch(() => { /* reclaim never blocks startup */ });
      }
    }, 0);
  }
  app.get('/api/landos/overview', (c) => {
    const entity = entityParam(c.req.query('entity'));
    const overview = getOverview(entity);
    const opportunitySnapshot = getExecutiveOpportunitySnapshot(entity as LandosEntity | undefined);
    const oc = opportunitySnapshot.counts;
    return c.json({
      ...overview,
      opportunityMetrics: {
        totalOpportunities: oc.total,
        newLeads: oc.leads,
        researchRunning: oc.research.queued + oc.research.running,
        researchFailed: oc.research.failed,
        researchIncomplete: oc.research.not_started + oc.research.partial + oc.research.failed,
        discoveryNeedsPreparation: oc.discovery.not_started,
        callsAwaitingTranscript: oc.discovery.brief_ready,
        transcriptsAwaitingReconciliation: oc.discovery.call_complete,
        ownerDecisions: oc.leads,
        followUpsDue: 0,
        followUpsOverdue: 0,
        pursuedDeals: oc.deals,
        browserProviderFailures: oc.research.failed,
        approvalRequired: overview.pendingApprovals,
      },
      storageProfile: (() => {
        const p = getLandosStorageProfile();
        return { mode: p.mode, label: p.label, syntheticOnly: p.syntheticOnly };
      })(),
      departments: DEPARTMENTS,
      pendingApprovalList: listApprovals('pending', 20),
    });
  });

  app.get('/api/landos/storage-profile', (c) => {
    const p = getLandosStorageProfile();
    return c.json({ mode: p.mode, label: p.label, syntheticOnly: p.syntheticOnly });
  });

  app.get('/api/landos/opportunities', (c) => {
    const entity = entityParam(c.req.query('entity')) as LandosEntity | undefined;
    return c.json(getExecutiveOpportunitySnapshot(entity));
  });

  app.get('/api/landos/opportunities/metrics', (c) => {
    const entity = entityParam(c.req.query('entity')) as LandosEntity | undefined;
    return c.json(getExecutiveOpportunitySnapshot(entity));
  });

  // Jarvis reads the exact same count/drilldown snapshot as Mission Control and
  // Acquisitions, so every number can be explained by opening its records.
  app.get('/api/landos/jarvis/opportunity-counts', (c) => {
    const entity = entityParam(c.req.query('entity')) as LandosEntity | undefined;
    const snapshot = getExecutiveOpportunitySnapshot(entity);
    return c.json({ ...snapshot, explanation: 'Counts are computed from the returned opportunity records using their lifecycle, research, and discovery states.' });
  });

  app.get('/api/landos/opportunities/:id', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id < 1) return c.json({ error: 'invalid id' }, 400);
    const opportunity = getOpportunityDetail(id);
    return opportunity ? c.json({ opportunity }) : c.json({ error: 'opportunity not found' }, 404);
  });

  app.get('/api/landos/opportunities/:id/research-mission', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || !getOpportunity(id)) return c.json({ error: 'opportunity not found' }, 404);
    return c.json({
      mission: latestResearchMission(id),
      quarantinedEvidence: listQuarantinedResearchEvidence(id),
    });
  });

  app.post('/api/landos/leads/manual', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const entity = isEntity(body.entity) ? body.entity : 'TY_LAND_BIZ';
    const conversationalRaw = typeof body.rawInput === 'string' ? body.rawInput : null;
    if (conversationalRaw !== null && !conversationalRaw.trim()) {
      return c.json({ error: 'Paste or dictate the lead information first.' }, 400);
    }
    // The operator's own LandPortal link is a first-class intake identifier. It
    // is accepted from an explicit form field under either spelling, and it is
    // written into the legacy raw shape too so the SAME parser that reads a
    // pasted link also sees a link typed into the form. Dropping it here was the
    // reason a supplied parcel link never reached Property Resolution.
    const suppliedLandPortalUrl =
      str(body.landPortalUrl)?.trim() || str(body.lpUrl)?.trim() || null;
    const legacyRaw = JSON.stringify({
      sellerName: str(body.sellerName)?.trim() ?? '', phone: str(body.phone)?.trim() ?? '',
      email: str(body.email)?.trim() ?? '', leadSource: str(body.leadSource)?.trim() || 'manual',
      address: str(body.address)?.trim() ?? '', apn: str(body.apn)?.trim() ?? '',
      acreage: str(body.acreage)?.trim() ?? '', city: str(body.city)?.trim() ?? '',
      county: str(body.county)?.trim() ?? '', state: str(body.state)?.trim() ?? '',
      // Present ONLY when the operator actually supplied a link, so a lead
      // without one keeps its exact previous raw shape and every hash derived
      // from it stays stable.
      ...(suppliedLandPortalUrl ? { landPortalUrl: suppliedLandPortalUrl } : {}),
      sellerClues: str(body.sellerClues)?.trim() ?? '',
    });
    const rawInput = conversationalRaw ?? legacyRaw;
    const parsed = conversationalRaw !== null ? parseConversationalLeadIntake(rawInput) : null;
    const smartIntakeLandPortalUrl = buildSmartIntake(rawInput).fields.lpUrl?.trim() || null;
    const operatorLandPortalUrl = suppliedLandPortalUrl || smartIntakeLandPortalUrl;
    // A canonical LandPortal URL deterministically carries the operator-supplied
    // parcel key. Decode that key at intake so an exact pointer does not become
    // an identity-empty card when the live browser lane is unavailable. These
    // values remain unverified operator hints; the normal discovery gate still
    // requires the opened parcel panel or an official source to corroborate them.
    const operatorLandPortalIdentity = landPortalIdentityFromUrl(operatorLandPortalUrl);
    const sellerName = parsed?.sellerName ?? (str(body.sellerName)?.trim() || null);
    const address = parsed?.address ?? (str(body.address)?.trim() || null);
    const apn = parsed?.apn ?? (str(body.apn)?.trim() || null) ?? operatorLandPortalIdentity?.apn ?? null;
    if (conversationalRaw === null && !sellerName) return c.json({ error: 'sellerName is required' }, 400);
    if (conversationalRaw === null && !address && !apn) return c.json({ error: 'address or APN is required' }, 400);
    const source = parsed?.leadSource ?? (str(body.leadSource)?.trim() || 'manual');
    const propertyLabel = parsed?.propertyLabel ?? address ?? (apn ? `Parcel ${apn}` : 'Unresolved property');
    const acresRaw = parsed?.acreage ?? (typeof body.acreage === 'number' ? body.acreage : Number(str(body.acreage)));
    const city = parsed?.city ?? (str(body.city)?.trim() || null);
    const county = parsed?.county ?? (str(body.county)?.trim() || null);
    const state = parsed?.state ?? (str(body.state)?.trim() || null)
      ?? stateFromCountyFips(operatorLandPortalIdentity?.fips) ?? null;
    const zip = parsed?.zip ?? (str(body.zip)?.trim() || null);
    // Whichever intake shape was used, the link the operator actually supplied
    // is the one stored: an explicit field wins, otherwise the link the parser
    // found inside the paste. It is stored as a SUBJECT HINT — never as verified
    // identity — so the LandPortal lanes can open the record instead of
    // rediscovering it, while the parcel itself is still confirmed by what the
    // opened record shows.
    // A lead with no property reference still needs its OWN property card, so
    // the placeholder carries a unique suffix. It is an internal storage handle;
    // `isPlaceholderPropertyLabel` keeps it off every owner-facing surface.
    const storageLabel = propertyLabel === 'Unresolved property' ? unresolvedLeadStorageLabel(Date.now()) : propertyLabel;
    const property = upsertPropertyCard({
      entity,
      activeInputAddress: storageLabel,
      city: city ?? undefined,
      county: county ?? undefined,
      state: state ?? undefined,
      zip: zip ?? undefined,
      apn: apn ?? undefined,
      fips: operatorLandPortalIdentity?.fips ?? undefined,
      lpPropertyId: operatorLandPortalIdentity?.propertyId ?? undefined,
      lpUrl: operatorLandPortalUrl ?? undefined,
      // The seller/lead name is NEVER written here. `owner` is the owner OF
      // RECORD, established only by an official source; seeding it from an
      // operator paste would silently satisfy the seller-authority name match
      // whose entire job is to catch a seller who is not the record owner.
      acres: Number.isFinite(acresRaw) && acresRaw > 0 ? acresRaw : undefined,
      verified: false,
      summary: rawInput,
      agentId: 'acquisitions-agent',
    }).card;
    const profile = getLandosStorageProfile();
    const deal = createDealCard({
      entity,
      // PROPERTY-FIRST title. A card is named by the property it concerns, not
      // by whether a seller name could be read out of the paste. The old
      // `${seller} — ${label}` shape produced "Unidentified seller — …" titles
      // that downstream surfaces then quoted back as if they were addresses.
      title: buildLeadCardTitle({ address, apn, city, county, state }),
      sellerNotes: rawInput,
      leadType: profile.syntheticOnly ? 'test' : 'manual',
    });
    linkPropertyToDeal({ dealCardId: deal.id, cardId: property.id, role: 'subject' });
    // EVERY link the operator supplied is filed as intake evidence, not only a
    // LandPortal one and not only into `lp_url`. That column is a single mutable
    // field research lanes also write, and a lane overwriting it is how a
    // supplied parcel link stopped existing; these rows are immutable, so the
    // operator's own words about the subject survive whatever the lanes do.
    recordIntakeLinks({
      dealCardId: deal.id,
      text: rawInput,
      urls: [suppliedLandPortalUrl],
      source: 'operator:new_lead',
    });
    // The seller/lead becomes a real person record with UNKNOWN authority, so
    // "Seller / Lead" is populated everywhere it is read and no signing
    // authority is implied by intake alone.
    if (sellerName) {
      const personId = addPerson({
        entity,
        name: sellerName,
        phone: parsed?.phone ?? (str(body.phone)?.trim() || undefined),
        email: parsed?.email ?? (str(body.email)?.trim() || undefined),
        notes: parsed?.sellerNameBasis ?? 'Seller/lead contact supplied at intake; not verified against the owner of record.',
      });
      linkPerson({
        personId,
        dealCardId: deal.id,
        cardId: property.id,
        role: 'seller',
        authorityStatus: 'unknown',
        note: 'Seller-stated contact from lead intake. Authority to sell and the owner-of-record match are unverified.',
      });
    }
    let opportunity = ensureOpportunityForLegacyDealCard(deal.id);
    getLandosDb().prepare(`
      UPDATE landos_opportunity SET source = ?, raw_input = ?, research_status = 'queued', pipeline_stage = 'researching', updated_at = unixepoch()
      WHERE id = ?
    `).run(source, rawInput, opportunity.id);
    opportunity = getOpportunity(opportunity.id)!;
    // Phase 5: saving a valid lead on an OPERATING profile automatically
    // launches the ONE Deal Intelligence parent mission for the created Deal
    // Card, fire-and-forget — the 201 below never waits on it. This REPLACES
    // queuePhase1Research on the operating manual-intake path so the old report
    // orchestration cannot run beside the canonical specialist graph. The helper advances
    // research_status (running -> complete/partial/failed) and builds the
    // discovery package + brief_ready from the mission outcome, so the
    // opportunity lifecycle is preserved. Duplicate submissions hit the
    // existing activeMission/activeRun guards and get the run in flight back.
    //
    // Vitest invokes the same Property Resolution capability synchronously and
    // without external lanes, because a fire-and-forget real mission would
    // outlive the per-test DB reset. Runtime profiles, including synthetic QA,
    // all use the governed Deal Intelligence graph whose root is this capability.
    if (process.env.NODE_ENV === 'test') {
      // Test processes cannot leave a real fire-and-forget mission writing into
      // the next test's reset database. They still invoke the SAME capability
      // root synchronously; only the external resolver lanes are omitted.
      await invokeRuntimeCapability({
        capabilityId: PROPERTY_RESOLUTION_CAPABILITY_ID,
        caller: { type: 'new_lead', ref: `deal:${deal.id}` },
        subject: {
          kind: 'raw_property',
          entity,
          rawInput,
          target: { dealCardId: deal.id, propertyCardId: property.id },
        },
        mode: 'reuse',
        context: { workflow: 'automatic_new_lead_test_boundary' },
      });
    } else {
      autoLaunchDealIntelligenceForIntake({
        dealCardId: deal.id,
        opportunityId: opportunity.id,
        capabilities: dealIntelligenceCapabilities(deal.id, 'new_lead', 'reuse'),
        missionStore: missionGraphStore,
        snapshotStore: propertyIntelligenceStore,
        browserCleanup: () => closeSurplusSessionPages(),
        afterCompletion: async () => {
          const current = getDealCard(deal.id);
          if (!current) return;
          const cycle = await runDealCoverageCycle(deal.id, current.entity as CapabilityEntity, 'automatic');
          if ('error' in cycle) {
            logger.warn({ dealCardId: deal.id, msg: cycle.error }, 'new_lead_coverage_cycle_skipped');
          }
        },
      });
    }
    return c.json({
      opportunityId: opportunity.id,
      publicUid: opportunity.publicUid,
      opportunity,
      dealCardId: deal.id,
      propertyCardId: property.id,
      researchStatus: opportunity.researchStatus,
      extraction: parsed ? {
        sellerName: parsed.sellerName, phone: parsed.phone, email: parsed.email,
        leadSource: parsed.leadSource, address: parsed.address, apn,
        city: parsed.city, county: parsed.county, state, acreage: parsed.acreage,
        dealIntelligence: parsed.dealIntelligence,
      } : null,
    }, 201);
  });

  app.post('/api/landos/opportunities/:id/research', (c) => {
    const id = Number(c.req.param('id'));
    const opportunity = Number.isInteger(id) ? getOpportunity(id) : undefined;
    if (!opportunity) return c.json({ error: 'opportunity not found' }, 404);
    const queued = updateOpportunityResearchStatus(id, 'queued', { actor: 'owner', note: 'Owner requested research run/retry.' });
    if (!queued.legacyDealCardId) return c.json({ error: 'opportunity has no Deal Card' }, 409);
    const launch = autoLaunchDealIntelligenceForIntake({
      dealCardId: queued.legacyDealCardId,
      opportunityId: queued.id,
      capabilities: dealIntelligenceCapabilities(queued.legacyDealCardId, 'deal_card', 'refresh'),
      missionStore: missionGraphStore,
      snapshotStore: propertyIntelligenceStore,
      browserCleanup: () => closeSurplusSessionPages(),
      afterCompletion: async () => {
        const current = getDealCard(queued.legacyDealCardId!);
        if (!current) return;
        await runDealCoverageCycle(queued.legacyDealCardId!, current.entity as CapabilityEntity, 'automatic');
      },
    });
    return c.json({ opportunity: queued, launch }, 202);
  });

  app.post('/api/landos/opportunities/:id/decision', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || !getOpportunity(id)) return c.json({ error: 'opportunity not found' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const decision = str(body.decision);
    if (decision === 'pursue') return c.json({ opportunity: ownerPursueOpportunity(id, { owner: 'owner' }) });
    if (decision === 'disposition') {
      const disposition = str(body.disposition) ?? '';
      if (!PHASE1_DISPOSITIONS.has(disposition)) return c.json({ error: 'invalid disposition' }, 400);
      return c.json({ opportunity: ownerDisposeOpportunity(id, { owner: 'owner', disposition }) });
    }
    return c.json({ error: 'decision must be pursue or disposition' }, 400);
  });

  app.get('/api/landos/opportunities/:id/discovery-package', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || !getOpportunity(id)) return c.json({ error: 'opportunity not found' }, 404);
    const discoveryPackage = buildOpportunityDiscoveryPackage(id, { persist: false });
    return c.json({ discoveryPackage });
  });

  app.post('/api/landos/opportunities/:id/discovery-package/run', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || !getOpportunity(id)) return c.json({ error: 'opportunity not found' }, 404);
    const discoveryPackage = buildOpportunityDiscoveryPackage(id, { persist: true, actor: 'property-research-agent' });
    updateOpportunityDiscoveryStatus(id, 'brief_ready', {
      actor: 'property-research-agent',
      note: discoveryPackage.callPrep.ready
        ? 'Pre-call research report is decision-useful.'
        : 'Pre-call research is incomplete; confirmation questions are available and unsupported conclusions remain blocked.',
    });
    return c.json({ discoveryPackage });
  });

  app.get('/api/landos/opportunities/:id/discovery-package/download', async (c) => {
    const id = Number(c.req.param('id'));
    const opportunity = Number.isInteger(id) ? getOpportunity(id) : undefined;
    if (!opportunity) return c.json({ error: 'opportunity not found' }, 404);
    const discoveryPackage = buildOpportunityDiscoveryPackage(id, { persist: false });
    const markdown = renderDiscoveryPackageMarkdown(discoveryPackage);
    const format = (c.req.query('format') ?? 'pdf').toLowerCase();
    const baseName = `discovery-package-${discoveryPackage.opportunityPublicUid}`;
    if (format === 'md' || format === 'markdown') {
      return new Response(markdown, { headers: {
        'content-type': 'text/markdown; charset=utf-8',
        'content-disposition': `attachment; filename="${baseName}.md"`,
        'cache-control': 'private, max-age=60',
      } });
    }
    const inspection = opportunity.primaryPropertyCardId ? loadPropertyInspection(opportunity.primaryPropertyCardId) : null;
    const visualRoot = landosArtifactPath('visuals');
    const imagePaths = (inspection?.assets ?? []).map((asset) => asset.storedPath).filter((storedPath) => {
      const resolved = path.resolve(storedPath);
      return resolved.startsWith(visualRoot + path.sep);
    });
    const pdf = await buildPropertyIntelligencePdf(markdown, imagePaths);
    return new Response(new Uint8Array(pdf), { headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${baseName}.pdf"`,
      'cache-control': 'private, max-age=60',
    } });
  });

  app.post('/api/landos/opportunities/:id/transcripts', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || !getOpportunity(id)) return c.json({ error: 'opportunity not found' }, 404);
    try {
      const contentType = c.req.header('content-type') ?? '';
      let content = '';
      let sourceType: 'paste' | 'upload' = 'paste';
      let fileName: string | null = null;
      let actor = 'operator';
      if (/multipart\/form-data/i.test(contentType)) {
        const body = await c.req.parseBody();
        const file = body.file;
        if (!(file instanceof File)) return c.json({ error: 'a text transcript file is required' }, 400);
        const textExtension = /\.(txt|text|md)$/i.test(file.name);
        const textMime = !file.type || /^(text\/(plain|markdown)|application\/octet-stream)$/i.test(file.type);
        if (!textExtension || !textMime) {
          return c.json({ error: 'initial transcript upload supports text files only' }, 400);
        }
        if (file.size > 2_000_000) return c.json({ error: 'transcript content exceeds 2 MB UTF-8 text limit' }, 400);
        content = await file.text();
        sourceType = 'upload';
        fileName = file.name;
        if (typeof body.actor === 'string' && body.actor.trim()) actor = body.actor.trim();
      } else {
        const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
        content = typeof body.content === 'string' ? body.content : '';
        sourceType = body.sourceType === 'upload' ? 'upload' : 'paste';
        fileName = typeof body.fileName === 'string' ? body.fileName : null;
        actor = typeof body.actor === 'string' && body.actor.trim() ? body.actor.trim() : 'operator';
      }
      return c.json(ingestAndReconcileTranscript({ opportunityId: id, content, sourceType, fileName, actor }), 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'transcript reconciliation failed' }, 400);
    }
  });

  app.get('/api/landos/opportunities/:id/transcripts', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || !getOpportunity(id)) return c.json({ error: 'opportunity not found' }, 404);
    return c.json({ transcripts: listOpportunityTranscripts(id) });
  });

  app.get('/api/landos/opportunities/:id/reconciliation', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || !getOpportunity(id)) return c.json({ error: 'opportunity not found' }, 404);
    const reconciliation = getLatestOpportunityReconciliation(id);
    return reconciliation
      ? c.json({ reconciliation, tasks: listOpportunityReconciliationTasks(id, reconciliation.id) })
      : c.json({ error: 'reconciliation not found' }, 404);
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

  // Mission provider catalog: for every provider this repository supports, WHETHER
  // a native mission child can route a model call to it right now, and whether the
  // upstream provider engine can drive an agent session on it. The two are
  // reported separately and neither is inferred from the other. Read-only; no
  // secret values (only configured/enabled booleans).
  app.get('/api/landos/model-router/mission-providers', (c) => {
    const registry = buildRegistryFromConfig();
    const catalog = describeMissionProviderCatalog({ registry });
    const hermes = resolveHermesUrl();
    return c.json({
      liveRouting: resolveLiveRouting().enabled,
      // Hermes is OPTIONAL by construction: unconfigured is the normal state and
      // native mission operation does not depend on it.
      hermes: {
        configured: !!hermes.url,
        source: hermes.source,
        optional: true,
        note: 'Optional. Native LandOS missions run fully without a Hermes endpoint; nothing requires it.',
      },
      missionRoutable: catalog.filter((entry) => entry.missionRoutable).map((entry) => entry.id),
      catalog,
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
      prohibitedActionTypes: PROHIBITED_ACTION_TYPES,
    });
  });

  app.post('/api/landos/approvals', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const { actionType, title, payload, requestedBy, entity } = body as Record<string, unknown>;
    if (typeof actionType !== 'string' || typeof title !== 'string' || !actionType || !title) {
      return c.json({ error: 'actionType and title are required' }, 400);
    }
    if (isProhibitedActionType(actionType)) {
      return c.json({ error: `action is prohibited and cannot be approved: ${actionType}` }, 403);
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
    const entity = entityParam(c.req.query('entity')) as LandosEntity | undefined;
    const cards = listOpportunityBoardCards(entity);
    const columns: Record<string, unknown[]> = {};
    for (const s of OPPORTUNITY_PIPELINE_STAGES) columns[s] = [];
    for (const card of cards) {
      // Compact quick-flip economic signal, from the PERSISTED Deal
      // Intelligence read — a pure SELECT per card, never a computation run.
      // Before a read exists (or on a pre-stack read) the honest state is
      // pending, not red: the seller owing us a price is not a failure.
      const deal = readDerivedSnapshot<DealIntelligenceProduct>(card.dealCardId, DEAL_INTELLIGENCE_PRODUCT_TYPE);
      const flip = deal && 'quickFlip' in deal && deal.quickFlip ? deal.quickFlip : null;
      columns[card.pipelineStage].push({
        ...card,
        quickFlip: deal && flip
          ? {
            status: flip.status,
            label: flip.statusLabel,
            fmv: flip.economics?.supportedFmv ?? null,
            cashMao: flip.economics?.cashMao ?? null,
            resaleDays: flip.resaleWindow?.expectedDays ?? null,
            cashVerdict: deal.sellerPriceVerdict?.verdict ?? null,
            dealScore: deal.scores?.deal?.score ?? null,
          }
          : { status: 'pending', label: 'Quick-flip pending', fmv: null, cashMao: null, resaleDays: null, cashVerdict: null, dealScore: null },
      });
    }
    return c.json({ columns, statuses: OPPORTUNITY_PIPELINE_STAGES });
  });

  app.patch('/api/landos/opportunities/:id/pipeline-stage', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || !getOpportunity(id)) return c.json({ error: 'opportunity not found' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const stage = str(body.stage);
    if (!stage || !(OPPORTUNITY_PIPELINE_STAGES as readonly string[]).includes(stage)) return c.json({ error: 'invalid pipeline stage' }, 400);
    return c.json({ opportunity: setOpportunityPipelineStage(id, stage as (typeof OPPORTUNITY_PIPELINE_STAGES)[number], 'owner') });
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

  // Owner correction for a lead's locality before parcel verification. This is
  // deliberately narrower than a parcel correction: it preserves the card,
  // address history, APN, owner, and verification state, and it can never
  // promote, merge, or substitute a parcel identity.
  app.post('/api/landos/property-cards/:id/locality-correction', async (c) => {
    const id = Number(c.req.param('id'));
    const existing = getPropertyCard(id);
    if (!existing) return c.json({ error: 'property card not found' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const city = str(body.city);
    const county = str(body.county);
    const state = str(body.state)?.toUpperCase();
    if (!city || !county || !state || !/^[A-Z]{2}$/.test(state)) {
      return c.json({ error: 'city, county, and a two-letter state are required' }, 400);
    }
    const result = upsertPropertyCard({
      entity: existing.entity as LandosEntity,
      cardId: id,
      activeInputAddress: existing.active_input_address,
      city,
      county,
      state,
      verified: false,
      summary: existing.summary,
      agentId: 'owner-locality-correction',
    });
    const locality = `${city}, ${county.replace(/\s+County$/i, '')} County, ${state}`;
    attachCardSourceEvidence({
      cardId: id,
      fact: 'Operator-confirmed locality',
      value: locality,
      sourceLabel: 'Owner correction',
      note: 'Locality correction only; it does not verify or replace the parcel identity.',
      parcelVerified: false,
    });
    attachCardActivity({
      cardId: id,
      agentId: 'owner-locality-correction',
      kind: 'locality_corrected',
      summary: `Lead locality corrected to ${locality}; parcel identity remains independently verified only through research.`,
    });
    return c.json({ card: result.card, warnings: result.warnings });
  });

  // A conflicting APN/owner is not a locality edit.  This guarded owner action
  // replaces an accepted parcel identity only when the operator supplies the
  // authoritative record and explicitly confirms the replacement. Existing
  // inspection evidence is retained for audit but quarantined when it conflicts
  // with the newly reconciled parcel; it is never merged into the new identity.
  app.post('/api/landos/property-cards/:id/verified-parcel-reconciliation', async (c) => {
    const id = Number(c.req.param('id'));
    const existing = getPropertyCard(id);
    if (!existing) return c.json({ error: 'property card not found' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const address = str(body.address) ?? existing.active_input_address;
    const city = str(body.city);
    const county = str(body.county);
    const state = str(body.state)?.toUpperCase();
    const apn = str(body.apn);
    const owner = str(body.owner);
    const acres = body.acres == null || body.acres === '' ? null : Number(body.acres);
    const sourceUrl = str(body.sourceUrl);
    const sourceLabel = str(body.sourceLabel) ?? 'Official parcel record';
    const deedReference = str(body.deedReference);
    if (!address || !city || !county || !state || !apn || !owner || !sourceUrl || !/^https?:\/\//i.test(sourceUrl)) {
      return c.json({ error: 'address, city, county, state, APN, owner, and an official source URL are required' }, 400);
    }
    if (!/^[A-Z]{2}$/.test(state)) return c.json({ error: 'state must be a two-letter code' }, 400);
    if (acres != null && (!Number.isFinite(acres) || acres <= 0)) {
      return c.json({ error: 'official acreage must be a positive number when supplied' }, 400);
    }
    if (body.confirmAcceptedIdentityReplacement !== true) {
      return c.json({ error: 'explicit confirmation is required before replacing an accepted parcel identity' }, 400);
    }
    const priorAddress = existing.active_input_address;
    const result = upsertPropertyCard({
      entity: existing.entity as LandosEntity,
      cardId: id,
      activeInputAddress: address,
      city,
      county,
      state,
      apn,
      owner,
      acres: acres ?? existing.acres ?? undefined,
      verified: true,
      verificationSource: `Owner-confirmed official parcel record — ${sourceLabel}: ${sourceUrl}`,
      summary: 'Operator-confirmed parcel identity reconciled against the supplied official record.',
      agentId: 'owner-verified-parcel-reconciliation',
    });
    attachCardSourceEvidence({
      cardId: id,
      fact: 'Official parcel identity',
      value: `${address} — APN ${apn}; owner ${owner}${acres == null ? '' : `; ${acres} acres`}`,
      sourceLabel,
      sourceUrl,
      note: 'Operator-confirmed replacement of a conflicting previously accepted parcel identity.',
      parcelVerified: true,
    });
    if (deedReference) {
      attachCardSourceEvidence({
        cardId: id,
        fact: 'Deed book/page',
        value: deedReference,
        sourceLabel,
        sourceUrl,
        note: 'Recorded reference shown by the authoritative parcel record; document image retrieval remains a separate evidence step.',
        parcelVerified: true,
      });
    }
    const dealCardId = getDealCardIdForPropertyCard(id);
    let opportunity = dealCardId ? getOpportunityByDealCardId(dealCardId) : null;
    if (dealCardId) {
      updateDealCard(dealCardId, { title: address });
      writeParcelIdentity(dealCardId, {
        subjectCardId: id,
        state: 'confirmed',
        basis: `Owner-confirmed official parcel record — ${sourceLabel}.`,
        confidence: 1,
        evidenceRefs: [sourceUrl],
        confirmedBy: 'owner-verified-parcel-reconciliation',
      }, 'owner-verified-parcel-reconciliation');
      synchronizePropertySummaryForDeal({
        dealCardId,
        actor: 'owner-verified-parcel-reconciliation',
        changeReason: 'Operator-confirmed official parcel identity reconciled; versioned Property Summary updated from the accepted identity.',
        allowAcceptedSupersession: true,
      });
    }
    if (opportunity) opportunity = updateOpportunityTitle(opportunity.id, address, {
      actor: 'owner-verified-parcel-reconciliation',
      note: `Canonical property identity updated from prior intake "${priorAddress}" to "${address}"; raw intake retained.`,
    });
    const reconciledConstraints = { address, city, county, state, apn, source: 'property_fallback' as const };
    const restored = opportunity ? restoreMatchingPropertyInspections(opportunity.id, id, reconciledConstraints) : [];
    const quarantined = opportunity ? quarantineMismatchedPropertyInspections(opportunity.id, id, reconciledConstraints) : [];
    if (opportunity) buildOpportunityDiscoveryPackage(opportunity.id, { persist: true, actor: 'owner-verified-parcel-reconciliation' });
    attachCardActivity({
      cardId: id,
      agentId: 'owner-verified-parcel-reconciliation',
      kind: 'verified_parcel_reconciled',
      summary: `Accepted parcel identity reconciled from prior input "${priorAddress}" to ${address}, APN ${apn}, owner ${owner}${acres == null ? '' : `, ${acres} official acres`}; ${restored.length} matching inspection record(s) restored and ${quarantined.length} conflicting record(s) quarantined.`,
    });
    return c.json({ card: result.card, dealCard: dealCardId ? getDealCard(dealCardId) : null, opportunity: opportunity ? getOpportunity(opportunity.id) : null, warnings: result.warnings, restored: restored.length, quarantined: quarantined.length });
  });

  // A recorder image must come from an operator-visible official record. This
  // explicit action stores one captured page with its source URL; it does not
  // log into a county site, create an account, or convert a book/page reference
  // into a document image. The shared registry projects it onto every owner
  // card that uses this property-card document model.
  app.post('/api/landos/property-cards/:id/recorded-deed-pages', async (c) => {
    const id = Number(c.req.param('id'));
    const existing = getPropertyCard(id);
    if (!existing) return c.json({ error: 'property card not found' }, 404);
    const body = await c.req.parseBody();
    const file = body.file;
    const documentId = str(body.documentId);
    const sourceUrl = str(body.sourceUrl);
    const sourceLabel = str(body.sourceLabel) ?? 'County recorder';
    const title = str(body.title) ?? 'Recorded deed';
    const pageNumber = Number(str(body.pageNumber));
    if (!(file instanceof File)) return c.json({ error: 'A recorder page image is required.' }, 400);
    if (!documentId || !sourceUrl || !/^https?:\/\//i.test(sourceUrl)) {
      return c.json({ error: 'A recorded document/book-page reference and official recorder URL are required.' }, 400);
    }
    if (String(body.confirmedOfficialSource ?? '') !== 'true') {
      return c.json({ error: 'Confirm that this exact image was displayed by the official county recorder before attaching it.' }, 400);
    }
    try {
      const page = recordDeedPage({
        cardId: id,
        documentId,
        pageNumber,
        fileName: file.name,
        mimeType: file.type,
        bytes: Buffer.from(await file.arrayBuffer()),
      });
      attachCardSourceEvidence({
        cardId: id,
        fact: 'Vesting deed',
        sourceLabel,
        sourceUrl,
        dateAccessed: new Date().toISOString(),
        note: `${title} — ${documentId}, cited page ${page.pageNumber}. Operator-attested image captured from the official county recorder page. This is preliminary document review, not a title search or title opinion.`,
        parcelVerified: true,
      });
      attachCardActivity({
        cardId: id,
        agentId: 'owner-recorded-deed-page',
        kind: 'recorded_deed_page_attached',
        summary: `Recorded deed page ${page.pageNumber} for ${documentId} attached from ${sourceLabel}.`,
        ref: sourceUrl,
      });
      return c.json({ page, sourceUrl, title }, 201);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  // Record an official lien-index or recorded-lien review. This shared owner
  // workflow intentionally stores a qualified result rather than a generic
  // "liens clear" flag: a name-index result alone cannot establish a property
  // encumbrance or clear title.
  app.post('/api/landos/property-cards/:id/recorded-lien-review', async (c) => {
    const id = Number(c.req.param('id'));
    const existing = getPropertyCard(id);
    if (!existing) return c.json({ error: 'property card not found' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    try {
      const review = validateRecordedLienReview({
        status: str(body.status) as RecordedLienStatus,
        sourceLabel: str(body.sourceLabel) ?? '',
        sourceUrl: str(body.sourceUrl) ?? '',
        searchedNameOrReference: str(body.searchedNameOrReference) ?? '',
        recordingReference: str(body.recordingReference),
        lienType: str(body.lienType),
        propertyMatch: str(body.propertyMatch),
        notes: str(body.notes),
        confirmedOfficialSource: body.confirmedOfficialSource === true,
      });
      attachCardSourceEvidence({
        cardId: id,
        fact: 'Recorded lien review',
        sourceLabel: review.sourceLabel,
        sourceUrl: review.sourceUrl,
        dateAccessed: new Date().toISOString(),
        note: review.note,
        parcelVerified: existing.verification_status === 'verified_property',
      });
      attachCardActivity({
        cardId: id,
        agentId: 'owner-recorded-lien-review',
        kind: 'recorded_lien_review',
        summary: `Recorded lien review saved: ${review.status.replace(/_/g, ' ')}.`,
        ref: review.sourceUrl,
      });
      return c.json({ review }, 201);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
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
    const action = str(body.action);
    if (!action) return c.json({ error: 'action required' }, 400);
    const createdBy = str(body.createdBy) ?? 'tyler';
    const priority = ['low', 'normal', 'high', 'urgent'].includes(str(body.priority) ?? '')
      ? str(body.priority) as 'low' | 'normal' | 'high' | 'urgent'
      : 'normal';
    const naId = addCardNextAction({
      cardId: id,
      action,
      createdBy,
      dueDate: str(body.dueDate),
      assignedOwner: str(body.assignedOwner),
      priority,
      reminderAt: str(body.reminderAt),
    });
    attachCardActivity({
      cardId: id,
      agentId: createdBy,
      kind: 'task_created',
      summary: `Task created: ${action}`,
      ref: `next_action:${naId}`,
    });
    return c.json({ id: naId }, 201);
  });

  app.patch('/api/landos/property-cards/:id/next-actions/:taskId', async (c) => {
    const cardId = Number(c.req.param('id'));
    const taskId = Number(c.req.param('taskId'));
    if (!Number.isInteger(cardId) || !Number.isInteger(taskId) || !getPropertyCard(cardId)) {
      return c.json({ error: 'task not found' }, 404);
    }
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const status = str(body.status);
    if (status && !['open', 'completed'].includes(status)) return c.json({ error: 'invalid task status' }, 400);
    const priority = str(body.priority);
    if (priority && !['low', 'normal', 'high', 'urgent'].includes(priority)) return c.json({ error: 'invalid priority' }, 400);
    const updated = updateCardNextAction(cardId, taskId, {
      action: str(body.action),
      status: status as 'open' | 'completed' | undefined,
      dueDate: str(body.dueDate),
      assignedOwner: str(body.assignedOwner),
      priority: priority as 'low' | 'normal' | 'high' | 'urgent' | undefined,
      reminderAt: str(body.reminderAt),
    });
    if (!updated) return c.json({ error: 'task not found' }, 404);
    attachCardActivity({
      cardId,
      agentId: 'landos/deal-card',
      kind: status === 'completed' ? 'task_completed' : 'task_updated',
      summary: status === 'completed' ? `Task completed: ${str(body.action) ?? `#${taskId}`}` : `Task updated: ${str(body.action) ?? `#${taskId}`}`,
      ref: `next_action:${taskId}`,
    });
    return c.json({ task: (getPropertyCard(cardId)?.nextActions as Array<Record<string, unknown>>).find((row) => Number(row.id) === taskId) });
  });

  app.delete('/api/landos/property-cards/:id/next-actions/:taskId', (c) => {
    const cardId = Number(c.req.param('id'));
    const taskId = Number(c.req.param('taskId'));
    if (!Number.isInteger(cardId) || !Number.isInteger(taskId) || !getPropertyCard(cardId)) {
      return c.json({ error: 'task not found' }, 404);
    }
    if (!deleteCardNextAction(cardId, taskId)) return c.json({ error: 'task not found' }, 404);
    attachCardActivity({
      cardId,
      agentId: 'landos/deal-card',
      kind: 'task_deleted',
      summary: `Task #${taskId} removed from this Deal Card.`,
      ref: `next_action:${taskId}`,
    });
    return c.json({ deleted: true, taskId });
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
    return c.json({ dealCards });
  });

  // Trash / Deleted Deal Cards view. Registered BEFORE '/deal-cards/:id' so the
  // literal 'trash' segment is not captured as an id. Soft-deleted cards only.
  app.get('/api/landos/deal-cards/trash', (c) => {
    const entity = entityParam(c.req.query('entity'));
    const dealCards = listTrashedDealCards({ entity });
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
    const opportunity = getOpportunityByDealCardId(id);
    // Parcel scope: which of the retained parcels is the subject, which belong
    // to the seller, and which are simply the neighbours a map sweep saw. Read
    // from the confirmed identity so a scope label can never restate the
    // subject, and guarded so a scope issue cannot break the Deal Card read.
    let parcelScope: DealParcelScopeView | undefined;
    try {
      const identity = getLandosDb().prepare(
        `SELECT apn, owner, acreage FROM landos_property_identity_version
           WHERE deal_card_id=? AND is_current=1 ORDER BY id DESC LIMIT 1`,
      ).get(id) as { apn: string | null; owner: string | null; acreage: number | null } | undefined;
      parcelScope = buildDealParcelScopeView({
        dealCardId: id,
        subjectApn: identity?.apn ?? null,
        subjectOwner: identity?.owner ?? null,
        subjectAcres: identity?.acreage ?? null,
        subjectIsVacant: subjectIsVacantLand(id, identity?.apn ?? null),
      });
    } catch { parcelScope = undefined; }
    return c.json({
      dealCard: deal,
      businessSpine,
      header: businessSpine?.header,
      opportunity,
      parcelScope,
      researchMission: opportunity ? latestResearchMission(opportunity.id) : null,
    });
  });

  // Add a seller/lead/contact to an existing Deal Card without changing the
  // parcel owner of record. Repeating the same name + role is idempotent.
  app.post('/api/landos/deal-cards/:id/people', async (c) => {
    const id = Number(c.req.param('id'));
    const deal = Number.isInteger(id) ? getDealCard(id) : undefined;
    if (!deal) return c.json({ error: 'deal card not found' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const name = str(body.name)?.trim();
    const requestedRole = str(body.role)?.trim().toLowerCase() ?? 'contact';
    if (!name) return c.json({ error: 'name is required' }, 400);
    if (!['seller', 'lead', 'contact', 'owner', 'heir', 'agent'].includes(requestedRole)) return c.json({ error: 'invalid contact role' }, 400);
    const role = ({ lead: 'lead_contact', contact: 'unknown_relation', owner: 'record_owner' } as Record<string, string>)[requestedRole] ?? requestedRole;
    const existing = ((deal.people ?? []) as Array<{ name?: unknown; role?: unknown }>).find((person) =>
      String(person.name ?? '').trim().toLowerCase() === name.toLowerCase()
      && String(person.role ?? '').trim().toLowerCase() === role,
    );
    if (!existing) {
      const personId = addPerson({
        entity: deal.entity as LandosEntity,
        name,
        phone: str(body.phone),
        email: str(body.email),
        mailingAddress: str(body.mailingAddress),
        preferredContactMethod: str(body.preferredContactMethod),
        notes: str(body.notes),
      });
      const linked = linkPerson({
        dealCardId: id,
        personId,
        role: role as Parameters<typeof linkPerson>[0]['role'],
        authorityStatus: str(body.authorityStatus) as Parameters<typeof linkPerson>[0]['authorityStatus'],
        note: str(body.relationshipNote),
      });
      if (linked.id && body.primaryContact === true) {
        getLandosDb().prepare('UPDATE landos_person_link SET primary_contact = 1 WHERE id = ?').run(linked.id);
      }
    }
    return c.json({ dealCard: getDealCard(id), created: !existing }, existing ? 200 : 201);
  });

  app.patch('/api/landos/deal-cards/:id/people/:personId', async (c) => {
    const id = Number(c.req.param('id'));
    const personId = Number(c.req.param('personId'));
    const deal = Number.isInteger(id) && Number.isInteger(personId) ? getDealCard(id) : undefined;
    if (!deal) return c.json({ error: 'contact not found' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const requestedRole = str(body.role)?.trim().toLowerCase();
    const role = requestedRole
      ? (({ lead: 'lead_contact', contact: 'unknown_relation', owner: 'record_owner' } as Record<string, string>)[requestedRole] ?? requestedRole)
      : undefined;
    if (role && !['seller', 'lead_contact', 'wholesaler', 'agent', 'record_owner', 'heir', 'sibling', 'spouse', 'decision_maker', 'probate_contact', 'attorney', 'title_contact', 'unknown_relation'].includes(role)) {
      return c.json({ error: 'invalid contact role' }, 400);
    }
    const authorityStatus = str(body.authorityStatus);
    if (authorityStatus && !['unknown', 'title_to_confirm', 'attorney_or_title_to_confirm', 'needs_to_sign', 'can_sign', 'cannot_sign', 'unsure_if_on_deed', 'heir_claimed', 'probate_attorney'].includes(authorityStatus)) {
      return c.json({ error: 'invalid authority status' }, 400);
    }
    const updated = updateDealPerson({
      dealCardId: id,
      personId,
      name: str(body.name),
      phone: str(body.phone),
      email: str(body.email),
      mailingAddress: str(body.mailingAddress),
      preferredContactMethod: str(body.preferredContactMethod),
      notes: str(body.notes),
      role: role as Parameters<typeof updateDealPerson>[0]['role'],
      authorityStatus: authorityStatus as Parameters<typeof updateDealPerson>[0]['authorityStatus'],
      authoritySource: str(body.authoritySource),
      relationshipNote: str(body.relationshipNote),
      primaryContact: body.primaryContact === undefined ? undefined : body.primaryContact === true,
    });
    if (!updated) return c.json({ error: 'contact not found on this Deal Card' }, 404);
    const cardId = subjectCardId(deal);
    if (cardId) attachCardActivity({
      cardId,
      agentId: 'landos/deal-card',
      kind: 'contact_updated',
      summary: `Contact updated: ${str(body.name) ?? `person #${personId}`}.`,
      ref: `person:${personId}`,
    });
    return c.json({ dealCard: getDealCard(id) });
  });

  app.delete('/api/landos/deal-cards/:id/people/:personId', (c) => {
    const id = Number(c.req.param('id'));
    const personId = Number(c.req.param('personId'));
    const deal = Number.isInteger(id) && Number.isInteger(personId) ? getDealCard(id) : undefined;
    if (!deal) return c.json({ error: 'contact not found' }, 404);
    if (!unlinkDealPerson(id, personId)) return c.json({ error: 'contact not found on this Deal Card' }, 404);
    const cardId = subjectCardId(deal);
    if (cardId) attachCardActivity({
      cardId,
      agentId: 'landos/deal-card',
      kind: 'contact_deleted',
      summary: `Contact #${personId} removed from this Deal Card.`,
      ref: `person:${personId}`,
    });
    return c.json({ deleted: true, personId });
  });

  // Living lead-card identity, smart intake, transcript, resource-contact, and
  // public-record surfaces. These routes return owner-facing records only; raw
  // model prompts/responses and routing machinery never leave the server.
  app.post('/api/landos/deal-cards/:id/identity/reconcile', async (c) => {
    const id = Number(c.req.param('id'));
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    try {
      const identity = reconcileDealPersonIdentity({
        dealCardId: id,
        canonicalName: str(body.canonicalName) ?? '',
        officialName: str(body.officialName) ?? '',
        knownIncorrectNames: Array.isArray(body.knownIncorrectNames) ? body.knownIncorrectNames.map(String) : [],
        actor: str(body.actor) ?? 'owner',
      });
      return c.json({ identity, dealCard: getDealCard(id) });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  app.get('/api/landos/deal-cards/:id/intake', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || !getDealCard(id)) return c.json({ error: 'deal card not found' }, 404);
    // History is preserved exactly as it was written. What changes is how it is
    // PRESENTED: once the Deal's canonical parcel identity is accepted, an older
    // attempt that concluded unresolved is historical, not the current state, and
    // it is labeled as such by the shared supersession rule rather than by a
    // literal in one component. Nothing is rewritten or deleted.
    const canonical = resolveCanonicalIdentity(id);
    const submissions = listLeadCardIntake(id).map((submission) => {
      const handoff = (submission as { resolutionHandoff?: Record<string, unknown> | null }).resolutionHandoff;
      if (!handoff) return submission;
      const attemptStatus = String(
        handoff.resolutionStatus ?? handoff.state ?? 'unresolved',
      );
      const { superseded, label } = supersessionLabel({
        canonical,
        attemptStatus: attemptStatus === 'attempted' ? 'unresolved' : attemptStatus,
        attemptAtSeconds: (submission as { createdAt?: number }).createdAt ?? null,
      });
      if (!superseded) return submission;
      return { ...submission, resolutionHandoff: { ...handoff, superseded: true, supersededLabel: label } };
    });
    return c.json({
      submissions,
      // The current accepted identity, so the conversation states what is true
      // now beside the attempts that were true then.
      canonicalIdentity: {
        status: canonical.status,
        confirmed: canonical.confirmed,
        apn: canonical.apn,
        owner: canonical.owner,
        county: canonical.county,
        state: canonical.state,
        basis: canonical.basis,
      },
      // What the retained documents actually established. Derived on read from
      // the same immutable artifacts, so the conversation shows the evidence
      // response without the operator sending another message.
      evidenceInterpretation: interpretRetainedDealEvidenceSafely(id),
    });
  });

  const configuredIntakeAnalyzer = async (prompt: string): Promise<unknown> => {
    const response = await generateContent(prompt, process.env.GEMINI_INTAKE_MODEL || 'gemini-2.0-flash');
    return parseJsonResponse<Record<string, unknown>>(response) ?? {};
  };

  const beginIntakeCandidateResolution = async (
    dealCardId: number,
    submissionId: number,
    candidateSets: Array<Record<string, string>>,
  ): Promise<Record<string, unknown>> => {
    const candidate = candidateSets.reduce<Record<string, string>>((merged, fields) => {
      for (const [key, value] of Object.entries(fields)) if (value && !merged[key]) merged[key] = value;
      return merged;
    }, {});
    // APN normalization variants are search keys only; the stored candidate
    // value is never changed. Punctuation/spacing variants come from the shared
    // exact-search helper; jurisdiction-specific decompositions are applied
    // inside the official adapters themselves.
    const apnAlternates = candidate.apn ? apnSearchVariants(candidate.apn).filter((variant) => variant !== candidate.apn) : [];
    const fields: ParsedIntakeFields = {
      address: candidate.address || candidate.road || undefined,
      apn: candidate.apn || undefined,
      apnAlternates: apnAlternates.length ? apnAlternates : undefined,
      county: candidate.county || undefined,
      state: candidate.state || undefined,
      city: candidate.city || undefined,
      zip: candidate.zip || undefined,
      owner: candidate.owner || undefined,
    };
    const usable = [fields.address, fields.apn, fields.county, fields.state, fields.owner].filter(Boolean);
    if (usable.length === 0) {
      const handoff = {
        state: 'awaiting_edit',
        attempted: false,
        candidateFields: fields,
        canonicalPromotionApplied: false,
        ownerContactMatchRequired: false,
        message: 'No address, APN, county, state, or owner was readable enough to start property resolution.',
      };
      updateLeadCardIntakeResolution(dealCardId, submissionId, handoff);
      return handoff;
    }
    const ownerVariants = fields.owner ? ownerSearchVariants(fields.owner) : [];
    // The explicit multi-path lookup order, shown to the operator verbatim.
    const lookupOrder = [
      fields.apn && (fields.county || fields.state)
        ? `Primary — official state/county parcel source by ${[fields.county, fields.state].filter(Boolean).join(', ')} + APN ${fields.apn}`
        : null,
      fields.apn
        ? `APN normalization variants (search keys only, candidate unchanged): ${[fields.apn, ...apnAlternates].join('  |  ')}`
        : null,
      fields.apn || fields.owner || fields.address
        ? 'LandPortal parcel-level browser search by county/state + APN (and owner). LandPortal property id + FIPS are discovered from the result — never required as input.'
        : null,
      fields.owner && fields.county
        ? `Independent — ${fields.county} + owner name "${fields.owner}" as a parcel-lookup key (variants: ${ownerVariants.join('  |  ')}). Never a seller-authority gate; a differing lead/wholesaler contact never blocks research.`
        : null,
      fields.address
        ? `Secondary corroboration only — address/road "${[fields.address, ...[fields.city, fields.zip].filter((part): part is string => !!part && !fields.address!.toUpperCase().includes(part.toUpperCase()))].join(', ')}". A materially different road is rejected, never accepted or corroborated.`
        : null,
    ].filter((value): value is string => !!value);
    const resolutionText = [
      fields.address ? `Address: ${fields.address}` : '',
      fields.city ? `City: ${fields.city}` : '',
      fields.state ? `State: ${fields.state}` : '',
      fields.zip ? `ZIP: ${fields.zip}` : '',
      fields.county ? `County: ${fields.county}` : '',
      fields.apn ? `APN: ${fields.apn}` : '',
      fields.owner ? `Screenshot owner candidate: ${fields.owner}` : '',
    ].filter(Boolean).join('\n');
    try {
      const deal = getDealCard(dealCardId);
      const targetCardId = deal ? subjectCardId(deal) : null;
      if (!deal || !targetCardId) throw new Error('Deal Card has no canonical subject Property Card.');
      const resolution = await invokeRuntimeCapability({
        capabilityId: PROPERTY_RESOLUTION_CAPABILITY_ID,
        caller: { type: 'new_lead', ref: `intake-submission:${submissionId}` },
        subject: {
          kind: 'raw_property',
          entity: deal.entity as LandosEntity,
          rawInput: resolutionText,
          target: { dealCardId, propertyCardId: targetCardId },
        },
        mode: 'reuse',
        context: { workflow: 'smart_intake', submissionId },
      }, {
        universalOptions: {
          indexedWeb: { search: createHermesFreeSearch(), fetchText: defaultGovFetchText, maxQueries: 3, maxPages: 3, timeoutMs: 20_000 },
          jurisdiction: { timeoutMs: 15_000 },
          deadlineMs: 65_000,
        },
      });
      const capabilityFacts = resolution.facts as Record<string, unknown>;
      const canonicalIdentity = (capabilityFacts.canonicalIdentity ?? {}) as Record<string, unknown>;
      const capabilityLanes = Array.isArray(capabilityFacts.lanes) ? capabilityFacts.lanes as Array<Record<string, unknown>> : [];
      // Source-by-source outcomes: exact facts each source returned, never a
      // bare count. Operator candidate input is excluded (it is the input).
      const sources = resolution.evidence.map((entry) => ({
        source: entry.source,
        lane: String(entry.details?.lane ?? 'property_resolution'),
        sourceUrl: entry.sourceUrl ?? null,
        confidence: entry.sourceType === 'official' ? 1 : 0.7,
        facts: canonicalIdentity,
      }));
      const laneOutcomes = capabilityLanes.map((lane) => ({
        lane: str(lane.id) ?? 'property_resolution',
        ran: str(lane.status) !== 'pending',
        status: str(lane.status) ?? 'unknown',
        verdict: lane.won === true || lane.applied === true ? 'accepted' : 'not accepted',
        reason: str(lane.note) ?? '',
      }));
      const rejected = laneOutcomes.filter((lane) => lane.ran && lane.verdict !== 'accepted');
      const nextIdentifier = smallestNextIdentifier({
        address: fields.address, city: fields.city, state: fields.state, zip: fields.zip,
        county: fields.county, fips: fields.fips, apn: fields.apn, owner: fields.owner, propertyId: fields.propertyId,
      });
      const confirmed = resolution.subjectResolution === 'RESOLVED';
      const promotion = confirmed
        ? { canonicalPromotionApplied: true, note: 'The Property Resolution Capability promoted only source-established identity through the shared canonical transition.' }
        : { canonicalPromotionApplied: false, note: 'No canonical promotion: Property Resolution did not release one exact parcel. Screenshot candidates remain non-canonical.' };
      // ── Reconcile THIS attempt with the ACCEPTED canonical identity ─────────
      // A confirmed Deal Card keeps its accepted parcel regardless of a later
      // attempt. A contradicting attempt is an operator-review flag, never a
      // revocation; a corroborating attempt is shown as corroboration.
      const acceptedIdentity = readParcelIdentity(dealCardId);
      const acceptedConfirmed = acceptedIdentity?.state === 'confirmed';
      const acceptedSummary = acceptedConfirmed ? readPropertySummaryForDeal(dealCardId) : null;
      // Prefer the synchronized summary APN; fall back to the confirmed subject
      // property card's APN so reconciliation works even when the read-model
      // slice has not been rebuilt yet.
      let acceptedCanonicalApn = acceptedSummary?.identity?.apn ?? null;
      if (acceptedConfirmed && !acceptedCanonicalApn) {
        const acceptedDeal = getDealCard(dealCardId);
        const acceptedCard = (acceptedDeal?.propertyCards as Array<Record<string, unknown>> | undefined)?.[0];
        if (acceptedCard && acceptedCard.verification_status === 'verified_property' && acceptedCard.apn) {
          acceptedCanonicalApn = String(acceptedCard.apn);
        }
      }
      const attemptApn = str(canonicalIdentity.apn);
      const reconciliation = reconcileAttemptWithAcceptedIdentity({
        acceptedState: acceptedIdentity?.state ?? null,
        acceptedCanonicalApn,
        attemptApn,
        attemptHasConflict: resolution.subjectResolution === 'AMBIGUOUS',
        attemptEstablished: confirmed,
      });
      const { attemptReconciliation, reconciliationMessage } = reconciliation;
      const handoff = {
        state: 'attempted',
        attempted: true,
        candidateFields: fields,
        apnVariantsTried: [fields.apn, ...apnAlternates].filter(Boolean),
        ownerVariants,
        lookupOrder,
        capabilityId: PROPERTY_RESOLUTION_CAPABILITY_ID,
        capabilityInvocationId: resolution.invocationId,
        resolutionStatus: resolution.subjectResolution.toLowerCase(),
        confidence: confirmed ? 1 : resolution.subjectResolution === 'AMBIGUOUS' ? 0.5 : 0,
        matchedReason: str(capabilityFacts.identityBasis) ?? 'No exact parcel was established.',
        // A confirmed Deal Card is established by an approved source regardless of
        // whether THIS attempt independently re-established it (req: a confirmed
        // card must never read "identity not yet established").
        identityEstablishedByApprovedSource: reconciliation.identityEstablishedByApprovedSource,
        identityBasis: str(capabilityFacts.identityBasis) ?? '',
        identityConflict: resolution.subjectResolution === 'AMBIGUOUS' ? capabilityFacts.candidates ?? [] : null,
        // Accepted-canonical reconciliation for the panel: the latest attempt is
        // history relative to the accepted identity, never an override of it.
        acceptedIdentityState: acceptedIdentity?.state ?? null,
        acceptedIdentityConfirmed: acceptedConfirmed,
        acceptedCanonicalApn,
        attemptReconciliation,
        reconciliationMessage,
        agreement: resolution.warnings.join(' '),
        missing: resolution.missingInformation,
        lanesAttempted: capabilityLanes,
        laneOutcomes,
        rejected,
        sources,
        browser: [],
        smallestNextIdentifier: nextIdentifier,
        guidance: resolution.missingInformation.join('; ') || null,
        canonicalPromotionApplied: promotion.canonicalPromotionApplied,
        promotion,
        ownerContactMatchRequired: false,
        message: confirmed
          ? `Parcel confirmed. ${str(capabilityFacts.identityBasis) ?? ''} ${promotion.note}`
          : `Screenshot candidates went through the canonical Property Resolution Capability. ${str(capabilityFacts.identityBasis) ?? 'No exact parcel was established.'} No screenshot field was promoted to canonical identity.`,
      };
      updateLeadCardIntakeResolution(dealCardId, submissionId, handoff);
      return handoff;
    } catch (error) {
      const handoff = {
        state: 'needs_retry',
        attempted: true,
        candidateFields: fields,
        lookupOrder,
        canonicalPromotionApplied: false,
        ownerContactMatchRequired: false,
        message: `Candidates were retained, but the approved-source resolution attempt needs retry: ${(error as Error).message}`,
      };
      updateLeadCardIntakeResolution(dealCardId, submissionId, handoff);
      return handoff;
    }
  };

  app.post('/api/landos/deal-cards/:id/intake', async (c) => {
    const id = Number(c.req.param('id'));
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    try {
      const idempotencyKey = str(body.submissionKey) ?? '';
      const existing = findLeadCardIntakeBySubmissionKey(id, idempotencyKey);
      if (existing) return c.json({ submission: existing, submissions: listLeadCardIntake(id), contacts: listResourceContacts(id), duplicatePrevented: true });
      const submission = await persistLeadCardIntake({
        dealCardId: id,
        text: str(body.text) ?? '',
        submissionType: body.submissionType === 'transcript' ? 'transcript' : 'general',
        source: str(body.source) ?? 'operator paste',
        idempotencyKey,
        modelAnalyzer: process.env.NODE_ENV === 'test' ? undefined : configuredIntakeAnalyzer,
      });
      return c.json({ submission, submissions: listLeadCardIntake(id), contacts: listResourceContacts(id) }, 201);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  app.post('/api/landos/deal-cards/:id/intake/upload', async (c) => {
    const id = Number(c.req.param('id'));
    const deal = getDealCard(id);
    if (!deal) return c.json({ error: 'deal card not found' }, 404);
    const body = await c.req.parseBody({ all: true });
    const asFiles = (value: unknown): File[] => Array.isArray(value)
      ? value.filter((item): item is File => item instanceof File)
      : value instanceof File ? [value] : [];
    const files = [...asFiles(body.files), ...asFiles(body.file)];
    if (files.length === 0) return c.json({ error: 'Choose one or more files to attach.' }, 400);
    if (files.length > 10) return c.json({ error: 'Smart Intake accepts up to 10 files in one submission.' }, 400);
    const idempotencyKey = String(Array.isArray(body.submissionKey) ? body.submissionKey[0] ?? '' : body.submissionKey ?? '');
    const existing = findLeadCardIntakeBySubmissionKey(id, idempotencyKey);
    if (existing) return c.json({ submission: existing, submissions: listLeadCardIntake(id), contacts: listResourceContacts(id), duplicatePrevented: true });
    const sourceMethodsRaw = String(Array.isArray(body.sourceMethods) ? body.sourceMethods[0] ?? '[]' : body.sourceMethods ?? '[]');
    const parsedSourceMethods = (() => {
      try { return JSON.parse(sourceMethodsRaw) as unknown; } catch { return []; }
    })();
    const sourceMethods = Array.isArray(parsedSourceMethods) ? parsedSourceMethods : [];
    // ONE path for every supplied file, and it is not this route's path. The
    // classify → read → file sequence lives in `deal-evidence-ingest`, keyed by
    // deal rather than by screen, so evidence arriving on an EXISTING deal
    // later (a county PDF in due diligence, a revised plat before closing) uses
    // the same ingestion without reopening New Lead. This route is one caller.
    try {
      const prepared = await prepareDealEvidence(
        await Promise.all(files.map(async (file, index) => ({
          fileName: file.name,
          mimeType: file.type || '',
          bytes: Buffer.from(await file.arrayBuffer()),
          sourceMethod: ['clipboard', 'upload', 'drop'].includes(String(sourceMethods[index]))
            ? String(sourceMethods[index]) as SmartIntakeImageSourceMethod
            : 'upload',
        }))),
        {
          readEvidence: async (bytes, classification) => (
            // Route tests must not pay for model calls. Formats LandOS reads
            // WITHOUT a model (text, Office containers) still run for real, so
            // the tests cover the readers they are meant to cover.
            process.env.NODE_ENV === 'test'
              && classification.interpreter !== 'text'
              && classification.interpreter !== 'ooxml'
              && classification.interpreter !== 'none'
              ? unavailableSmartIntakeImageExtraction('Model extraction is disabled in route tests.', 'test')
              : extractIntakeArtifact(bytes, classification)
          ),
        },
      );
      const transcript = isTranscriptEvidence(
        prepared,
        String(Array.isArray(body.submissionType) ? body.submissionType[0] ?? '' : body.submissionType ?? ''),
      );
      const intakeArtifacts = dealEvidenceArtifacts(id, prepared, (item, docType) => saveDocumentUpload({
        dealCardId: id,
        category: 'other',
        title: item.fileName,
        docType,
        fileName: item.fileName,
        mimeType: item.classification.mimeType,
        bytes: item.bytes,
        note: `Immutable Smart Intake evidence — ${item.classification.kind} (${item.sourceMethod}).`,
      }), transcript);
      const operatorNote = String(Array.isArray(body.note) ? body.note[0] ?? '' : body.note ?? '');
      const text = dealEvidenceSubmissionText(prepared, operatorNote);
      const submission = await persistLeadCardIntake({
        dealCardId: id,
        text,
        submissionType: transcript ? 'transcript' : 'general',
        source: str(Array.isArray(body.source) ? body.source[0] : body.source) ?? 'Deal Card smart intake',
        fileName: intakeArtifacts[0].originalFileName,
        fileUrl: intakeArtifacts[0].fileUrl,
        mimeType: intakeArtifacts[0].mimeType,
        idempotencyKey,
        imageArtifacts: intakeArtifacts,
        modelAnalyzer: process.env.NODE_ENV === 'test' ? undefined : configuredIntakeAnalyzer,
      });
      const handoff = await beginIntakeCandidateResolution(
        id,
        Number(submission.id),
        intakeArtifacts.map((artifact) => artifact.extraction.candidates as Record<string, string>),
      );
      // ── Understand the evidence BEFORE reacting to it ──────────────────
      //
      // The coverage cycle used to fire on the fact that a file arrived. It now
      // fires on what the file SAID. Interpretation reads the extractions this
      // upload just retained, turns them into page-provenanced claims, and
      // reconciles them against the Deal's working conclusion — no retrieval, no
      // model call, no second evidence store — so the cycle that follows already
      // knows which requirements the documents closed and which they contested.
      const interpretation = interpretRetainedDealEvidenceSafely(id);

      // ── New evidence is itself a trigger into the closed research loop ──
      //
      // Retaining the attachment was never the whole job. Evidence arriving on
      // a Deal is exactly the event the coverage cycle exists to react to: it
      // reconciles what the Deal now knows, replans coverage, lets the
      // specialists declare what they still require, runs ONLY that delta
      // through the existing orchestrator, and cascades the intelligence that
      // actually moved. That is the same `runDealCoverageCycle` Re-run Research
      // calls — one loop, two triggers — so nothing here is a second research
      // engine and the operator never has to press a button to make LandOS
      // think about a file it just accepted.
      //
      // It runs as `automatic`, which deliberately does NOT reopen settled
      // PARTIAL lanes: an upload closes gaps, it does not license re-running
      // research nobody is still asking for. Re-run Research keeps that power.
      //
      // Detached on purpose. The upload response is the operator's receipt and
      // must not wait on retrieval; the conversation reads the cycle's result
      // from retained state the moment it settles, and a cycle that fails
      // leaves the retained evidence untouched.
      if (process.env.NODE_ENV !== 'test') {
        void runDealCoverageCycle(id, deal.entity as CapabilityEntity, 'automatic', interpretation)
          .catch((error) => logger.warn(
            { dealCardId: id, err: (error as Error).message },
            'deal_evidence_coverage_cycle_failed',
          ));
      }
      return c.json({
        submission: { ...submission, resolutionHandoff: handoff },
        // What LandOS decided each file was and whether it could read it, so
        // the conversation can say so instead of the operator guessing.
        artifactRouting: prepared.map((item) => item.routing),
        // The Deal reacts to this evidence on its own; the conversation says so
        // rather than leaving the operator with "(6 attachments)" and silence.
        evidenceTriggeredResearch: true,
        // What the documents actually said, so Smart Intake answers from the
        // real pages instead of a canned acknowledgement.
        evidenceInterpretation: interpretation,
        submissions: listLeadCardIntake(id),
        contacts: listResourceContacts(id),
      }, 201);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  app.post('/api/landos/deal-cards/:id/intake/:submissionId/candidates', async (c) => {
    const id = Number(c.req.param('id'));
    const submissionId = Number(c.req.param('submissionId'));
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    try {
      const values = body.values && typeof body.values === 'object'
        ? Object.fromEntries(Object.entries(body.values as Record<string, unknown>).map(([key, value]) => [key, String(value ?? '')]))
        : {};
      const submissions = updateLeadCardIntakeCandidates({ dealCardId: id, submissionId, values });
      const saved = submissions.find((submission) => submission.id === submissionId);
      const candidateSets = ((saved?.artifacts ?? []) as Array<{ candidates?: Array<{ key: string; value: string }> }>).map((artifact) =>
        Object.fromEntries((artifact.candidates ?? []).map((candidate) => [candidate.key, candidate.value])),
      );
      const handoff = await beginIntakeCandidateResolution(id, submissionId, candidateSets);
      return c.json({ submissions: listLeadCardIntake(id), resolutionHandoff: handoff });
    } catch (error) {
      return c.json({ error: (error as Error).message }, 400);
    }
  });

  app.get('/api/landos/deal-cards/:id/resources', (c) => {
    const id = Number(c.req.param('id'));
    const deal = getDealCard(id);
    if (!deal) return c.json({ error: 'deal card not found' }, 404);
    return c.json({ categories: RESOURCE_CATEGORIES, contacts: listResourceContacts(id), people: deal.people ?? [] });
  });

  app.post('/api/landos/deal-cards/:id/resources', async (c) => {
    const id = Number(c.req.param('id'));
    if (!getDealCard(id)) return c.json({ error: 'deal card not found' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    try {
      const contact = upsertResourceContact({
        dealCardId: id,
        category: String(body.category ?? 'other') as ResourceContactInput['category'],
        organization: str(body.organization), department: str(body.department), representative: str(body.representative),
        role: str(body.role), phone: str(body.phone), email: str(body.email), website: str(body.website), address: str(body.address),
        jurisdiction: str(body.jurisdiction), notes: str(body.notes), source: str(body.source), lastContactedDate: str(body.lastContactedDate),
        linkedItems: Array.isArray(body.linkedItems) ? body.linkedItems.map(String) : [], nextFollowUp: str(body.nextFollowUp),
      });
      return c.json({ contact, contacts: listResourceContacts(id) }, 201);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  app.get('/api/landos/deal-cards/:id/public-records', (c) => {
    const id = Number(c.req.param('id'));
    const deal = getDealCard(id);
    if (!deal) return c.json({ error: 'deal card not found' }, 404);
    const cards = (deal.propertyCards ?? []) as Array<Record<string, unknown>>;
    const subject = (cards.find((card) => card.role === 'subject') ?? cards[0] ?? {}) as Record<string, unknown>;
    const hierarchy = publicRecordSearchHierarchy({
      county: str(subject.county), state: str(subject.state), city: str(subject.city), apn: str(subject.apn), owner: str(subject.owner),
      address: str(subject.active_input_address), acreage: num(subject.acres), lat: num(subject.lat), lng: num(subject.lng),
    });
    return c.json({ hierarchy, records: listPublicRecordOutcomes(id) });
  });

  app.get('/api/landos/deal-cards/:id/public-records/:recordId/artifact', (c) => {
    const id = Number(c.req.param('id'));
    const recordId = Number(c.req.param('recordId'));
    if (!Number.isInteger(id) || !Number.isInteger(recordId)) return c.json({ error: 'invalid public-record artifact' }, 400);
    if (!getDealCard(id)) return c.json({ error: 'deal card not found' }, 404);
    const record = listPublicRecordOutcomes(id).find((row) => Number(row.id) === recordId);
    const stored = record ? str(record.screenshot_url) : null;
    if (!stored) return c.json({ error: 'artifact not found' }, 404);
    const root = path.resolve(getLandosStorageProfile().artifactRoot);
    const resolved = path.resolve(stored);
    const relative = path.relative(root, resolved);
    if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative) || !fs.existsSync(resolved)) {
      return c.json({ error: 'artifact not available' }, 404);
    }
    const bytes = fs.readFileSync(resolved);
    const ext = path.extname(resolved).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'application/octet-stream';
    return c.body(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, 200, {
      'Content-Type': mime,
      'Content-Disposition': `inline; filename="${path.basename(resolved).replace(/"/g, '')}"`,
      'Cache-Control': 'private, max-age=3600',
    });
  });

  app.post('/api/landos/deal-cards/:id/public-records', async (c) => {
    const id = Number(c.req.param('id'));
    if (!getDealCard(id)) return c.json({ error: 'deal card not found' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    try {
      const record = upsertPublicRecordOutcome({
        dealCardId: id, category: str(body.category) ?? '', title: str(body.title) ?? '', jurisdiction: str(body.jurisdiction) ?? '',
        authority: str(body.authority) ?? '', retrievalStatus: String(body.retrievalStatus ?? 'retrieved_no') as PublicRecordOutcomeInput['retrievalStatus'],
        summary: str(body.summary) ?? '', facts: body.facts && typeof body.facts === 'object' ? body.facts as Record<string, unknown> : {},
        sourceUrl: str(body.sourceUrl), screenshotUrl: str(body.screenshotUrl), documentUrl: str(body.documentUrl), searchedAt: str(body.searchedAt), nextFollowUp: str(body.nextFollowUp),
      });
      return c.json({ record, records: listPublicRecordOutcomes(id) }, 201);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
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
  // The Market Pulse read, extracted so the Deal Intelligence mission's Market
  // Pulse child runs the SAME code the operator's Market tab reads. Two
  // implementations would be free to quote two different county $/ac.
  const marketPulseForDeal = async (id: number): Promise<{ marketPulse: unknown; parcelConfirmed: boolean } | null> => {
    const deal = getDealCard(id);
    if (!deal) return null;
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
    const subjectZip = extractZipCandidate(addr);
    const pulseRegistry = compRegistryForDeal(id, {
      state: str(subj?.state) ?? dd.state ?? null,
      county: str(subj?.county) ?? dd.county ?? null,
      zip: subjectZip,
      acres: typeof subj?.acres === 'number' ? subj.acres : null,
    }, (persistedReport.marketComps as unknown as ReportCompLanes) ?? null);
    const comps: PulseComp[] = pulseRegistry.validatedSold.map((comp) => ({
      pricePerAcre: comp.primary.pricePerAcre,
      price: comp.primary.price,
      acres: comp.primary.acres ?? comp.acres,
      zip: extractZipCandidate(String(comp.address ?? '')) ?? null,
    }));
    // The parcel-attributed ("Parcel Verified") pulse is gated on the AUTHORITATIVE
    // ConfirmedParcel capability, not the legacy card flag. A Candidate parcel still
    // gets honest, clearly-labeled AREA context (usable unresolved leads), never
    // parcel-attributed market data.
    // The subject's own retained Market Research record. Market Pulse used only
    // the Census key and retrieved comps, so a brand-new lead reported growth
    // "unknown" and county $/acre "not established" while the quarterly
    // collection already held both. This supplies them, attributed.
    const pulseMarketContext = marketContextFor(deal);
    const pulseRetained = pulseMarketContext.read.available
      ? {
        population: pulseMarketContext.county.metrics?.population
          ?? pulseMarketContext.subjectBand.metrics?.population ?? null,
        populationGrowth: pulseMarketContext.county.metrics?.populationGrowth
          ?? pulseMarketContext.subjectBand.metrics?.populationGrowth ?? null,
        medianPricePerAcre: pulseMarketContext.liquidity.medianPricePerAcre,
        soldCount: pulseMarketContext.liquidity.soldCount,
        period: pulseMarketContext.liquidity.period,
        resolvedVia: pulseMarketContext.liquidity.resolvedVia,
        provider: pulseMarketContext.county.provider ?? pulseMarketContext.subjectBand.provider,
      }
      : null;
    const areaInput = {
      city: str(subj?.city) || undefined,
      county: str(subj?.county) || dd.county || undefined,
      state: str(subj?.state) || dd.state || undefined,
      zip: subjectZip,
      fips: str(subj?.fips) || undefined,
      comps,
      retainedCounty: pulseRetained,
    };
    const confirmed = confirmParcelForDeal(id);
    const marketPulse = confirmed
      ? await fetchConfirmedParcelMarketPulse(confirmed, areaInput)
      : await fetchAreaMarketContext(areaInput);
    // Single valuation story: when the report computed a sold-band median (the
    // basis of the Preliminary Valuation), the pulse quotes THAT number — never
    // a different median recomputed over a wider comp set.
    const bandMedian = marketPulse.countyPricePerAcre?.medianPpa ?? null;
    const bandCount = pulseRegistry.counts.validatedSold;
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
    return { marketPulse, parcelConfirmed: !!confirmed };
  };

  app.get('/api/landos/deal-cards/:id/market-pulse', async (c) => {
    const id = Number(c.req.param('id'));
    const result = await marketPulseForDeal(id);
    if (!result) return c.json({ error: 'not found' }, 404);
    return c.json(result);
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

  // The Market Scan's actual transport: the governed keyless Hermes free search
  // AND the grounded Gemini search, merged and deduped. Either answering is a
  // real answer; only both failing is honestly "unavailable". A rural county
  // that Gemini grounding returns nothing for is exactly the case that used to
  // read as "no market activity" when it was really "one transport was quiet".
  const marketScanSearch = (): ScanSearchFn | null => composeScanSearch([
    hermesScanSearch(createHermesFreeSearch()),
    groundedScanSearch(),
  ]);

  const internalCountySnapshotsForDeal = (deal: unknown): InternalCountyAcreageSnapshot[] => {
    const record = deal as { title?: string; propertyCards?: Array<Record<string, unknown>> };
    const subject = record.propertyCards?.find((card) => card.role === 'subject') ?? record.propertyCards?.[0] ?? {};
    const inspection = Number.isInteger(Number(subject.id)) ? loadPropertyInspection(Number(subject.id)) : null;
    const lpFact = (...labels: string[]): string | null => {
      for (const label of labels) {
        const value = str(inspection?.parcelFacts?.[label]);
        if (value && value !== '-') return value;
      }
      return null;
    };
    const state = str(subject.state) || lpFact('Parcel Address State');
    // The situs address alone often lacks the ZIP; the operator's retained raw
    // lead input (card summary) is the next honest source before giving up.
    const zip = str(subject.zip)
      || extractZipCandidate(str(subject.active_input_address) || str(record.title) || '')
      || lpFact('Parcel Address Zip Code')
      || extractZipCandidate(str(subject.summary) || '');
    const fips = str(subject.fips);
    const countyName = str(subject.county) || lpFact('Parcel Address County');
    const retainedMrCounty = !fips && state && countyName
      ? getLandosDb().prepare(
        `SELECT fips, name FROM landos_mr_geography
         WHERE level = 'county' AND state = ?
           AND (lower(name) = lower(?) OR lower(name) = lower(?))
         LIMIT 1`,
      ).get(state.toUpperCase(), countyName, countyName.replace(/\s+county$/i, '').trim()) as { fips: string; name: string } | undefined
      : undefined;
    const countyRef = fips
      ? { fips, state: state ?? '', countyName: countyName || fips }
      : resolveCountyRefByZip(zip, state)
        ?? resolveCountyRefByName(countyName, state)
        ?? (retainedMrCounty ? { fips: retainedMrCounty.fips, state: state ?? '', countyName: retainedMrCounty.name } : undefined);
    if (!countyRef) return [];
    const practicalBandSources: ReadonlyArray<{
      band: InternalCountyAcreageSnapshot['band'];
      sourceBand: AcreageBand;
    }> = [
      { band: '50+', sourceBand: '50-100' },
      { band: '20-50', sourceBand: '20-50' },
      { band: '10-20', sourceBand: '10-20' },
      { band: '5-10', sourceBand: '5-10' },
      { band: '2-5', sourceBand: '2-5' },
      { band: '1-2', sourceBand: '1-2' },
      { band: '0-1', sourceBand: '0-1' },
    ];
    // A derived Market Research snapshot is never evidence on its own. It may
    // outlive its canonical `landos_market_snapshot` source after a geography
    // correction. If this county has no current source rows, render no county
    // coverage rather than carrying stale (and potentially cross-state) counts
    // into the operator's Market Score.
    const drilldown = getCountyDrilldown(countyRef.fips);
    if (!drilldown?.snapshots.length) return [];
    const retained = practicalBandSources.flatMap(({ band, sourceBand }) => {
      const snapshot = listMrSnapshots()
        .filter((candidate) => candidate.filters.acreageBand === sourceBand)
        .sort((a, b) => b.quarter.localeCompare(a.quarter) || b.id - a.id)[0];
      if (!snapshot) return [];
      const summary = getMrGeoSummary(snapshot.id, `county:${countyRef.fips}`);
      if (!summary) return [];
      return [{
        band,
        side: 'sold' as const,
        period: summary.snapshot.quarter,
        metrics: summary.row.metrics,
        confidence: 'high' as const,
        provider: summary.row.provider || summary.snapshot.provider,
        sourceRef: summary.row.sourceRef,
        extractionTimestamp: summary.row.observedAt || summary.snapshot.collectedAt,
        coverage: `${summary.row.name || countyRef.countyName}, sold ${sourceBand}-acre LandOS Market Research snapshot, ${summary.snapshot.quarter}`,
      }];
    });
    const requiredBands = new Set(['50+', '20-50', '10-20', '5-10', '2-5', '1-2', '0-1']);
    const legacy = drilldown.snapshots
      .filter((snapshot) => requiredBands.has(snapshot.acreageBand))
      .filter((snapshot) => !retained.some((row) => row.band === snapshot.acreageBand && row.side === snapshot.side))
      .map((snapshot) => ({
        band: snapshot.acreageBand as InternalCountyAcreageSnapshot['band'],
        side: snapshot.side,
        period: snapshot.period,
        metrics: snapshot.metrics,
        confidence: snapshot.confidence,
        provider: snapshot.provider,
        sourceRef: snapshot.sourceRef,
        extractionTimestamp: snapshot.extractionTs,
        coverage: `${drilldown.countyName} County, ${snapshot.side === 'sold' ? 'sold' : 'for-sale'} ${snapshot.acreageBand}-acre band, ${snapshot.period}`,
      }));
    return [...retained, ...legacy];
  };

  const rehydrateCachedAcreageMatrix = (deal: unknown, scan: MarketScanResult): MarketScanResult => {
    const record = deal as { propertyCards?: Array<Record<string, unknown>> };
    const subject = record.propertyCards?.find((card) => card.role === 'subject') ?? record.propertyCards?.[0] ?? {};
    const internalCountySnapshots = internalCountySnapshotsForDeal(deal);
    if (!internalCountySnapshots.length) return scan;
    return {
      ...scan,
      acreageMatrix: buildPracticalMarketMatrix({
        observations: [],
        internalCountySnapshots,
        subjectAcres: num(subject.acres),
      }),
    };
  };

  app.get('/api/landos/deal-cards/:id/market-scan', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const deal = getDealCard(id);
    if (!deal) return c.json({ error: 'not found' }, 404);
    const cached = loadMarketScan<MarketScanResult>(id, 'market_scan');
    const refresh = c.req.query('refresh') === '1';
    // ONE market scan for the whole product. This route used to run its own
    // search-only scan, so the Market tab and the Deal Intelligence mission
    // could report different data-center answers for the same subject — and the
    // tab's answer never screened the 20-mile radius at all.
    let scan: MarketScanResult | null;
    try {
      scan = await operatorMarketScanForDeal(id, deal, { force: refresh });
    } catch (err) {
      logger.warn({ err, dealCardId: id }, 'market_scan_failed');
      return c.json({ marketScan: cached?.payload ?? null, cached: !!cached, error: 'market scan failed' });
    }
    if (!scan) return c.json({ marketScan: cached?.payload ?? null, cached: !!cached });
    const answered = (s: string) => s === 'found' || s === 'none_found';
    const ran = answered(scan.dataCenterWatch.status) || answered(scan.growthSignals.status);
    if (ran) return c.json({ marketScan: scan, cached: false });
    // Not answered this time — serve any prior REAL answer; else the honest
    // unavailable/not_run result (uncached).
    const cachedAnswered = cached && (answered((cached.payload as MarketScanResult).dataCenterWatch?.status) || answered((cached.payload as MarketScanResult).growthSignals?.status));
    return c.json({ marketScan: cachedAnswered ? cached!.payload : scan, cached: !!cachedAnswered });
  });

  app.get('/api/landos/deal-cards/:id/data-center-map', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    if (!getDealCard(id)) return c.json({ error: 'not found' }, 404);
    const cached = loadMarketScan<MarketScanResult>(id, 'market_scan');
    const storedPath = cached?.payload.dataCenterWatch.browserMapEvidence?.screenshotPath;
    if (!storedPath) return c.json({ error: 'data-center map not captured' }, 404);
    const resolved = path.resolve(storedPath);
    const root = landosArtifactPath('browser-shots');
    if (!resolved.startsWith(root + path.sep)) return c.json({ error: 'forbidden' }, 403);
    try {
      const buf = fs.readFileSync(resolved);
      return new Response(new Uint8Array(buf), {
        headers: { 'content-type': 'image/png', 'cache-control': 'private, no-store' },
      });
    } catch {
      return c.json({ error: 'data-center map not found' }, 404);
    }
  });

  // The utility map capture behind a corridor finding.
  //
  // The path comes from the retained utility record rather than the request, so
  // a caller cannot name a file; it is then confined to the browser-shots root
  // the same way every other retained capture is.
  app.get('/api/landos/deal-cards/:id/utility-availability/map/:utility', (c) => {
    const id = Number(c.req.param('id'));
    const utility = c.req.param('utility');
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    if (utility !== 'water' && utility !== 'sewer') return c.json({ error: 'invalid utility' }, 400);
    const deal = getDealCard(id);
    if (!deal) return c.json({ error: 'not found' }, 404);
    const cardId = subjectCardId(deal);
    if (cardId == null) return c.json({ error: 'this Deal Card has no canonical subject Property Card yet' }, 409);
    const record = loadUtilityAvailabilityRecord(cardId);
    const stored = record?.[utility]?.corridor?.source.screenshotPath;
    if (!stored) return c.json({ error: 'no utility map capture retained' }, 404);
    const resolved = path.resolve(stored);
    const root = landosArtifactPath('browser-shots');
    if (!resolved.startsWith(root + path.sep)) return c.json({ error: 'forbidden' }, 403);
    try {
      const buf = fs.readFileSync(resolved);
      return new Response(new Uint8Array(buf), {
        headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=3600' },
      });
    } catch {
      return c.json({ error: 'utility map capture not found' }, 404);
    }
  });

  app.get('/api/landos/deal-cards/:id/comp-image/:apn', (c) => {
    const id = Number(c.req.param('id'));
    const apn = c.req.param('apn');
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    if (!getDealCard(id)) return c.json({ error: 'not found' }, 404);
    if (!/^[A-Za-z0-9_-]+$/.test(apn)) return c.json({ error: 'invalid apn' }, 400);
    const file = `deal${id}_comp_${apn}.png`;
    const root = landosArtifactPath('browser-shots');
    const resolved = path.resolve(root, file);
    if (!resolved.startsWith(root + path.sep)) return c.json({ error: 'forbidden' }, 403);
    try {
      const buf = fs.readFileSync(resolved);
      return new Response(new Uint8Array(buf), {
        headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=3600' },
      });
    } catch {
      return c.json({ error: 'comp image not found' }, 404);
    }
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
    const identity = readParcelIdentity(id);
    const snapshot = readResolutionSnapshot(id);
    // The canonical subject state is the shared answer. This endpoint used to
    // AND the card's official-verification flag with the spine verdict, so a
    // research-grade established subject reported confirmed:false here while
    // every other surface showed the resolved parcel. Official verification is
    // reported separately; it never erases an established working subject.
    const subjectState = resolveCanonicalSubjectState(id);
    return c.json({
      parcelIdentity: identity,
      snapshot,
      confirmed: subjectState.subjectResolved,
      officiallyVerified: subjectState.officiallyVerified,
      subject: subjectState,
    });
  });

  // Pre-Call Intelligence handoff — the backend read model for the seller call.
  //
  // A pure SELECT over the durable post-resolution snapshots: property
  // backstory, controlling land-use authority, current zoning, subdivision
  // rules and the property-specific read, plus the property-specific seller
  // questions derived from them. It retrieves nothing, so it is safe to call
  // repeatedly and it answers identically after a restart.
  app.get('/api/landos/deal-cards/:id/pre-call-intelligence', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    if (!getDealCard(id)) return c.json({ error: 'not found' }, 404);
    return c.json(readPreCallIntelligenceHandoff(id));
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
  // ── Deal Card Strategy worksheet (manual/local; honest readiness) ──────
  // A safe local landing place for the Strategy leg. Manual/local strategy
  // analysis only: candidates, recommendation, most viable exit, blockers, next
  // confirmations, distinct per-strategy notes, and an honest offer-readiness
  // label that defaults to 'not_reviewed'. Computes no offer/comp/EV and keeps
  // every exit strategy distinct. No external CRM/GHL, no paid/LandPortal calls.
  // ── Deal Card Market Research worksheet (manual/local; market-level only) ──
  // A safe local landing place for the Market Research leg. MARKET-LEVEL context
  // only: target area, county/city/region notes, demand notes (with honest
  // demand labels), active/sold/days-on-market context notes, county growth /
  // planning notes, exit-strategy support notes, source links + confidence, data
  // gaps, and risk flags. This is NOT property-level DD and never verifies parcel
  // identity. No comps, actives, solds, days-on-market, demand, or pricing are
  // computed or fabricated. No external CRM/GHL, no paid/LandPortal calls.
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
    // A no-match lead may have no county on the Property Card. Use retained
    // parcel-page geography for area Market Matrix context only; it never feeds
    // subject geometry or parcel facts.
    const inspection = Number.isInteger(Number(pc.id)) ? loadPropertyInspection(Number(pc.id)) : null;
    const lpFact = (...labels: string[]): string | undefined => {
      for (const label of labels) {
        const value = sv(inspection?.parcelFacts?.[label]);
        if (value && value !== '-') return value;
      }
      return undefined;
    };
    const marketState = sv(pc.state) ?? lpFact('Parcel Address State');
    const marketCounty = sv(pc.fips) ?? sv(pc.county) ?? lpFact('Parcel Address County');
    const zip = sv(pc.zip) ?? extractZipCandidate(sv(pc.active_input_address) ?? sv(d.title));
    const acres = typeof pc.acres === 'number' && pc.acres > 0 ? pc.acres : null;
    if (acres != null && acres >= 50) {
      return buildMarketMatrixReportSection(resolveMarketMatrix({
        state: marketState,
        county: marketCounty,
        zip,
        acreageBand: acres < 100 ? '50-100' : '100+',
        side: 'sold',
      }));
    }
    return resolveMarketMatrixSection({ state: marketState, county: marketCounty, zip, acres, side: 'sold' });
  };

  // SOP 10B: property-scoped market context joined at read time from the
  // LandOS Market Research store (never from LandPortal market panels).
  const marketContextFor = (deal: unknown): PropertyMarketContext => {
    const d = deal as { id?: number; title?: string; propertyCards?: Array<Record<string, unknown>> };
    const pc = d.propertyCards?.[0] ?? {};
    const sv = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
    const inspection = Number.isInteger(Number(pc.id)) ? loadPropertyInspection(Number(pc.id)) : null;
    const lpFact = (...labels: string[]): string | undefined => {
      for (const label of labels) {
        const value = sv(inspection?.parcelFacts?.[label]);
        if (value && value !== '-') return value;
      }
      return undefined;
    };
    // The confirmed situs is often street-only and the card ZIP may be blank;
    // the retained raw lead input keeps the operator-typed ZIP.
    const rawLeadZip = (): string | undefined => {
      if (!Number.isInteger(d.id)) return undefined;
      const rawInput = getOpportunityByDealCardId(d.id as number).rawInput ?? '';
      return extractZipCandidate(rawInput.split(/\r?\n/)[0] ?? '');
    };
    return propertyMarketContextFor({
      county: sv(pc.fips) ?? sv(pc.county) ?? lpFact('Parcel Address County') ?? null,
      state: sv(pc.state) ?? lpFact('Parcel Address State') ?? null,
      zip: sv(pc.zip) ?? extractZipCandidate(sv(pc.active_input_address) ?? sv(d.title)) ?? rawLeadZip() ?? null,
      acres: typeof pc.acres === 'number' && pc.acres > 0 ? pc.acres : null,
    });
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
    const utilityRecord = input.cardId ? loadUtilityAvailabilityRecord(input.cardId) : null;
    const utilityAvailability = utilityRecord
      ? projectUtilityAvailability(utilityRecord, {
        address: null, apn: null, county: null, state: null, acres: null,
      })
      : null;
    const strategyReadiness = strategyReadinessForDeal({
      parcelVerified: !!r.parcelVerified,
      registry: compRegistry,
      operatorRecord: input.operatorRecord,
      valuationConflict: !!r.valuation?.conflict,
      improved: buildingArea > 0,
      hardRisks: r.riskFlags ?? null,
      utilityKnowledge: utilityAvailability?.knowledge ?? null,
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
    const subjectCoords = (() => {
      const first = (deal as { propertyCards?: unknown[] }).propertyCards?.[0] as { lat?: unknown; lng?: unknown } | undefined;
      return typeof first?.lat === 'number' && typeof first?.lng === 'number' ? { lat: first.lat, lng: first.lng } : null;
    })();
    // Rank the closest available 1–5 accepted SOLD comps first. This exact
    // shortlist drives the FMV, owner analysis, strategy, and executive summary.
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
      } catch { /* coordinates are enrichment; missing distance excludes a sale from the closest shortlist */ }
      report.bestComps = bestCompsFromRegistry(registry, subjectAcres, { subjectCoords, coordsByAddress });
    }
    // Valuation is the arithmetic mean of exact sold price ÷ acreage for that
    // ranked shortlist. Active asking listings remain context and never gate FMV.
    // Reproject environmental facts on read so retained reports immediately get
    // Zone-X equivalence and LandPortal parcel-wide wetland coverage.
    const envFacts = reconcileFacts({
      factSheet: report.landportalInspection?.factSheet ? {
        environment: {
          femaFloodZone: report.landportalInspection.factSheet.environment?.femaFloodZone ?? null,
          wetlandsPct: report.landportalInspection.factSheet.environment?.wetlandsPct ?? null,
        },
      } : null,
      govDd: report.govDd,
    });
    if (report.reconciliation) {
      const retainedConflicts = (report.reconciliation.conflicts ?? []).filter((row) => !/fema flood sources disagree|wetlands sources disagree/i.test(row));
      report.reconciliation = {
        ...report.reconciliation,
        flood: envFacts.flood,
        wetlands: envFacts.wetlands,
        conflicts: [...retainedConflicts, ...envFacts.conflicts],
      };
    }
    const landPortalValue = landPortalValuationStats(report.landportalInspection?.comparables, subjectAcres);
    const currentCompsValuation = buildCompsValuationView(id);
    const currentValuationSummary = currentCompsValuation?.summary ?? null;
    // V2's persisted accepted-comp selection is the current valuation truth.
    // The legacy report calculation remains a fallback for cards that predate
    // that projection, but it may not deny a supported V2 value merely because
    // no legacy LandPortal inspection row was materialized.
    const currentProjectedValuation = currentValuationSummary?.fmv
      ? {
          primary: {
            id: 'current_accepted_closed_sales',
            label: currentValuationSummary.basisLabel,
            value: currentValuationSummary.fmv.central,
            ppa: currentValuationSummary.medianPricePerAcre,
            kind: 'comp_sold' as const,
            rank: 1,
            note: currentValuationSummary.statusReason,
          },
          supporting: [],
          confidence: currentValuationSummary.confidence === 'high'
            ? 'high' as const
            : currentValuationSummary.confidence === 'moderate' ? 'medium' as const : 'low' as const,
          conflict: false,
          conflictNote: null,
          valueRange: {
            low: currentValuationSummary.fmv.low ?? currentValuationSummary.fmv.central,
            high: currentValuationSummary.fmv.high ?? currentValuationSummary.fmv.central,
            basisId: 'current_accepted_closed_sales',
          },
          nextAction: currentValuationSummary.acquisitionLockedReason,
        }
      : null;
    const projectedValuation = currentProjectedValuation
      ?? valuationFromRegistry(registry, subjectAcres, report.valuation, report.bestComps, report.landportalInspection?.comparables);
    if (currentValuationSummary?.status === 'supported') {
      report.ddFactChecklist = report.ddFactChecklist.map((row) => {
        if (!row.value || !/valuation remains separate and is pending accepted closed subject-band evidence/i.test(row.value)) return row;
        return {
          ...row,
          value: row.value.replace(/\s*Parcel-level valuation remains separate and is pending accepted closed subject-band evidence\.?/i, '').trim(),
        };
      });
    }
    const reconciledWetlandText = report.reconciliation?.wetlands?.primary ?? '';
    const reconciledWetlandMatch = reconciledWetlandText.match(/(\d+(?:\.\d+)?)\s*%/);
    const reconciledWetlandPct = reconciledWetlandMatch
      ? Number(reconciledWetlandMatch[1])
      : /\b(?:none|no wetlands?)\s+mapped\b|\bno mapped wetland/i.test(reconciledWetlandText)
        ? 0
        : null;

    const operatorRetainedAcres = parseAcresValue(fact('acres')) ?? subjectAcres;
    const operatorProviderAcres = report.landportalInspection?.factSheet?.acres
      ?? parseAcresValue(inspectionForVisuals?.parcelFacts.Acres)
      ?? parseAcresValue(inspectionForVisuals?.parcelFacts['Calc Acres']);
    const operatorOfficiallyVerified = String(prop0.verification_status ?? '') === 'verified_property';
    const operatorRecord = buildOperatorPropertyRecord(publicRun, {
      // The SUBJECT PROPERTY CARD is the identity of record for this Deal Card.
      // The deal TITLE is a human label and is never an address: falling back to
      // it put "Unidentified seller — 4713 sinking creek rd" in the situs field,
      // where the header printed it as the property and the seller-question
      // builder quoted it back as the road to the property.
      situsAddress: String(fact('situsAddress') ?? nonPlaceholderAddress(str(prop0.active_input_address)) ?? ''),
      city: str(prop0.city) ?? (fact('city') as string | null),
      // county/state/apn/owner previously read `dealRecord`, which has no such
      // columns — so a known jurisdiction on the property card was silently
      // dropped and the card showed a blank county/state for a lead that had
      // both. Every locality field now reads the same record `city` does.
      county: (fact('county') as string | null) ?? str(prop0.county) ?? null,
      state: (fact('state') as string | null) ?? str(prop0.state) ?? null,
      apn: (fact('apn') as string | null) ?? str(prop0.apn) ?? null,
      owner: (fact('owner') as string | null) ?? str(prop0.owner) ?? null,
      // Shared acreage parser: "1.15 ac" is a value, never NaN → "? ac".
      // A LandPortal-backed working identity is sufficient to continue
      // discovery, but it is not an assessor roll.  Attribute its acreage to
      // the provider until an official parcel source returns an acreage.
      assessedAcres: operatorOfficiallyVerified ? operatorRetainedAcres : null,
      providerAcres: operatorProviderAcres,
      acreageDisputed: !!report.reconciliation?.acreage?.conflict,
      coordinates: subjectCoords,
      reconciledWetlandPct,
      reconciledWetlandSource: report.reconciliation?.wetlands?.primarySource ?? null,
      parcelVerified: report.parcelVerified,
      verificationSource: report.parcelVerificationStatus,
      compCount: registry.counts.validatedSold,
      valuationCompCount: currentValuationSummary?.acceptedCount ?? landPortalValue.count,
      valuationReady: currentValuationSummary
        ? currentValuationSummary.status === 'supported' && currentValuationSummary.fmv != null
        : landPortalValue.count > 0 && landPortalValue.averagePricePerAcre != null && subjectAcres != null && subjectAcres > 0,
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
    return { registry, projectedValuation, operatorRecord, recordedEvidence, canonical, subjectAcres, currentCompsValuation };
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
  }, canonicalDealStateFor(report.dealCardId));

  // Read-only composition of existing canonical records. This route deliberately
  // does not invoke browser or provider lanes, or independently derive WS1-WS3.
  app.get('/api/landos/lead-workspace/:id', async (c) => {
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
    const opportunity = getOpportunityByDealCardId(id);
    const workspace = buildLeadWorkspace({
      deal: deal as unknown as Record<string, unknown>,
      report: report as unknown as Record<string, unknown>,
      acquisition: acquisition as unknown as Record<string, unknown>,
      nextAction: nextAction as unknown as Record<string, unknown>,
      operatorRecord: projection.operatorRecord as unknown as Record<string, unknown>,
      canonical: projection.canonical as unknown as Record<string, unknown>,
      compRegistry: projection.canonical.compRegistry as unknown as Record<string, unknown>,
      documents: (projection.canonical.documentRegistry ?? {}) as unknown as Record<string, unknown>,
      mission: {
        legacy: missionViewForCard(cardId) ?? {},
        research: latestResearchMission(opportunity.id),
        quarantinedEvidence: listQuarantinedResearchEvidence(opportunity.id),
      } as unknown as Record<string, unknown>,
      activity: cardId ? getCardActivity(cardId) : [],
      marketPulse: null,
      marketMatrix: marketMatrixFor(deal),
      resolution: readResolutionSnapshot(id) as unknown as Record<string, unknown> | null,
    });
    // The owner brief is a live market read. Retain only the material,
    // source-bound public evidence in its concise Market Pulse; no raw feed or
    // browser trace is exposed here.
    const browserMarketIntel = await browserIntelFor(deal as unknown as Record<string, unknown>);
    const { summarizeGrowthDrivers } = await import('./browser-market-intelligence.js');
    const growthSummary = loadGrowthSummary(cardId ?? null) ?? summarizeGrowthDrivers(browserMarketIntel as never);
    const discoveryPackage = buildOpportunityDiscoveryPackage(opportunity.id, {
      persist: false,
      marketResearch: { browserIntel: browserMarketIntel, growthSummary },
    });
    return c.json({
      ...workspace,
      property: { ...workspace.property, cardId },
      opportunity: { ...opportunity, lifecycleStatus: opportunity.lifecycle },
      discoveryPackage,
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
    const legacyReport = getDealCardReport(id);
    const currentSnapshot = propertyIntelligenceView(id).snapshot;
    const compatibleReport = legacyReport.exists
      ? legacyReport
      : projectPropertyIntelligenceSnapshotForReport(currentSnapshot, legacyReport);
    const report = projectPublicScreening(compatibleReport ?? legacyReport, publicRun);
    if (!report.exists) return c.json({ error: 'run Property Intelligence before downloading a report' }, 400);
    const cardId = subjectCardId(deal);
    if (cardId) report.landportalInspection = projectPropertyInspectionForReport(cardId);
    mergeStoredBrowserFacts(report, id);
    const sellerSummary = summarizeSellerFacts(cardId ? loadSellerStatedFacts(cardId) : []);
    // A download is a pure projection over retained truth. It must never start a
    // browser/news research lane merely because an optional growth snapshot is
    // absent; null is the honest persisted state.
    const growthSummary = loadGrowthSummary(cardId ?? null);
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
    const executiveSummary = gatedExecutiveSummaryFor(report, growthSummary ?? undefined, publicRun, projection);
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
      currentCompsValuation: projection.currentCompsValuation ?? undefined,
    });
    const inspection = cardId ? loadPropertyInspection(cardId) : null;
    const imagePaths = (inspection?.assets ?? []).map((a) => a.storedPath).filter((p) => {
      const resolved = path.resolve(p);
      const root = landosArtifactPath('visuals');
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
    const terminalStatus = terminalParcelStatus(deal);
    if (terminalStatus) return c.json(terminalParcelError(terminalStatus), 409);
    // Completed staged LandPortal packages are immutable evidence records. The
    // normal reconcile action is their single promotion boundary: it performs
    // no browser/provider work and makes every Deal Card workspace consume the
    // standard property, inspection, visual, comp, identity, and market stores.
    const stagedPromotion = reconcilePersistedLandPortalEvidence(id);
    const refreshedDeal = getDealCard(id) ?? deal;
    const refreshedProp = (refreshedDeal.propertyCards?.[0] ?? {}) as Record<string, unknown>;
    const refreshedReport = getDealCardReport(id);
    const result = reconcileDealCard({
      dealCardId: id,
      cardId,
      subject: {
        state: str(refreshedProp.state) ?? null,
        county: str(refreshedProp.county) ?? null,
        acres: typeof refreshedProp.acres === 'number' ? (refreshedProp.acres as number) : null,
      },
      reportLanes: (refreshedReport.marketComps as unknown as ReportCompLanes) ?? null,
    });
    const registry = compRegistryForDeal(id, { state: str(refreshedProp.state) ?? null, county: str(refreshedProp.county) ?? null }, (refreshedReport.marketComps as unknown as ReportCompLanes) ?? null);
    const modelVersion = modelVersionForCard(cardId, registry);
    // Refresh the RAG index from the card's accepted evidence (idempotent —
    // content-hash keyed, no external calls, no paid providers).
    let ragSynced = 0;
    try { ragSynced = ingestCardEvidence({ dealCardId: id, cardId, county: str(refreshedProp.county) ?? null, state: str(refreshedProp.state) ?? null, apn: str(refreshedProp.apn) ?? null, address: str(refreshedProp.active_input_address) ?? null }).length; } catch { ragSynced = 0; }
    landosAudit('landos/reconcile', 'deal_card_reconciled', `deal ${id}: ${result.note}`, { refTable: 'landos_deal_card', refId: id });
    return c.json({ ...result, stagedPromotion, modelVersion, ragSynced });
  });

  // ── Embedded LandOS comp map (final deduplicated registry, every property) ──
  // The interactive map + comp table payload: subject marker, unified registry
  // markers with labeled PPA + provider links + selection scores + exclusion
  // reasons. Coordinates are read-only enrichment: registry/provider coords,
  // persisted comp rows, then prior cache entries. GET never calls a geocoder
  // and never writes application state. Never a paid map API.
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

    // Location evidence: canonical registry/provider coordinates → persisted comp
    // rows → previously retained geocode cache, indexed under EVERY identity a
    // record can be recognized by (registry key, parcel APN, reconciled address).
    // Keying this join on the raw address alone silently unplaced every comp
    // whose identity is an APN and every capture carrying provider listing
    // chrome. Active enrichment belongs in a mutation/run workflow, never this
    // owner-facing GET projection.
    const db = getLandosDb();
    const retainedUniques = [...registry.uniqueComps, ...registry.validatedSold, ...registry.validatedActive];
    const locationRecords: RetainedLocationRecord[] = [];
    for (const comp of retainedUniques) {
      locationRecords.push({
        key: comp.key,
        apn: comp.apn,
        state: comp.state,
        address: comp.address,
        sourceUrl: comp.primary.sourceUrls[0] ?? null,
        lat: comp.lat,
        lng: comp.lng,
        source: comp.coordinateProvider ? `${comp.coordinateProvider} map point` : `${comp.providers[0] ?? 'Source'} map point`,
      });
    }
    for (const r of listComps({ dealCardId: id })) {
      locationRecords.push({
        key: r.canonical_key || null,
        apn: r.apn || null,
        state: r.state || null,
        address: r.address_desc || null,
        sourceUrl: r.source_url || null,
        lat: typeof r.lat === 'number' ? r.lat : null,
        lng: typeof r.lng === 'number' ? r.lng : null,
        source: `${r.source_label} map point`,
      });
    }
    const cacheGet = db.prepare('SELECT lat, lng, provider FROM landos_geocode_cache WHERE address_key = ?');
    for (const comp of retainedUniques) {
      const postal = reconcileCompAddress({ capturedAddress: comp.address, sourceUrl: comp.primary.sourceUrls[0] ?? null });
      const key = compAddressKey(postal?.postalAddress);
      if (!key) continue;
      const cached = cacheGet.get(key) as { lat: number | null; lng: number | null; provider: string } | undefined;
      if (typeof cached?.lat === 'number' && typeof cached?.lng === 'number') {
        locationRecords.push({
          key: comp.key,
          apn: comp.apn,
          state: comp.state,
          address: postal?.postalAddress ?? comp.address,
          lat: cached.lat,
          lng: cached.lng,
          source: `retained ${cached.provider} address geocode`,
        });
      }
    }
    const retainedGeometry = new PublicIntelligenceStore().load(id)?.orchestration?.subjectGeometry;
    const subjectPolygon = retainedGeometry?.rings?.[0]
      ?.map((point) => ({ lng: Number(point[0]), lat: Number(point[1]) }))
      .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng)
        && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180) ?? null;
    const view = buildCompMapView({
      subject: {
        address: str(prop.active_input_address) ?? null,
        apn: str(prop.apn) ?? null,
        acres: typeof prop.acres === 'number' ? (prop.acres as number) : null,
        lat: typeof prop.lat === 'number' ? (prop.lat as number) : null,
        lng: typeof prop.lng === 'number' ? (prop.lng as number) : null,
        polygon: subjectPolygon && subjectPolygon.length >= 3 ? subjectPolygon : null,
      },
      registry,
      locations: buildRetainedLocationIndex(locationRecords),
    });
    return c.json({ compMap: view });
  });

  // ── RAG knowledge layer (local-first FTS; canonical records stay authoritative) ──
  app.post('/api/landos/deal-cards/:id/comp-map/enrich', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const deal = getDealCard(id);
    if (!deal) return c.json({ error: 'deal card not found' }, 404);
    const prop = (deal.propertyCards?.[0] ?? {}) as Record<string, unknown>;
    const report = getDealCardReport(id);
    const registry = compRegistryForDeal(id, {
      state: str(prop.state) ?? null,
      county: str(prop.county) ?? null,
      acres: typeof prop.acres === 'number' ? (prop.acres as number) : null,
    }, (report?.marketComps as unknown as ReportCompLanes) ?? null);
    const addresses = [...registry.validatedSold, ...registry.validatedActive].map((comp) => comp.address).filter((address): address is string => !!address);
    const result = await enrichCompCoordinates(id, { max: 100, addresses });
    landosAudit('landos/comp-map', 'comp_map_locations_enriched', `deal ${id}: ${result.enriched} comp location(s) recovered; ${result.unresolved} source description(s) unresolved`, { refTable: 'landos_deal_card', refId: id });
    return c.json({ enrichment: result });
  });

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
          city: subject.locality,
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

  // One shared, cached-per-request read of the Deal's retained evidence. Every
  // surface that needs the reconciled answer calls THIS - the workspace's first
  // paint, Documents & Uploads, and Smart Intake - so no surface carries its own
  // copy of the acreage/boundary selection rules.
  function interpretRetainedDealEvidenceSafely(dealCardId: number): DealEvidenceInterpretation | null {
    try {
      return interpretRetainedDealEvidence(dealCardId);
    } catch (error) {
      logger.warn({ dealCardId, err: (error as Error).message }, 'deal_evidence_interpretation_failed');
      return null;
    }
  }

  /** The reconciled acreage alone, for reads that only need the working figure. */
  function evidenceAcreageFor(dealCardId: number) {
    return interpretRetainedDealEvidenceSafely(dealCardId)?.acreage ?? null;
  }

  // Derived, idempotent, and free: the interpretation of everything this Deal
  // has already retained. Documents & Uploads reads it to show the deed/survey
  // grouping and every claim's exact page, and a hard refresh re-derives the
  // same answer from the same immutable artifacts.
  app.get('/api/landos/deal-cards/:id/evidence/interpretation', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || !getDealCard(id)) return c.json({ error: 'deal card not found' }, 404);
    try {
      return c.json({ interpretation: interpretRetainedDealEvidence(id) });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.get('/api/landos/deal-cards/:id/documents/uploads', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    return c.json({ uploads: listDocumentUploads(id) });
  });

  app.patch('/api/landos/deal-cards/:id/documents/uploads/:uploadId', async (c) => {
    const id = Number(c.req.param('id'));
    const uploadId = Number(c.req.param('uploadId'));
    const deal = Number.isInteger(id) && Number.isInteger(uploadId) ? getDealCard(id) : undefined;
    if (!deal) return c.json({ error: 'document not found' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const category = str(body.category);
    if (category && !UPLOAD_CATEGORIES.some((row) => row.value === category)) return c.json({ error: 'invalid category' }, 400);
    try {
      const upload = updateDocumentUpload(id, uploadId, {
        title: str(body.title),
        category: category as RegisteredDocument['category'] | undefined,
        docType: str(body.docType),
        documentDate: body.documentDate === null ? null : str(body.documentDate),
        note: body.note === null ? null : str(body.note),
      });
      if (!upload) return c.json({ error: 'document not found' }, 404);
      const cardId = subjectCardId(deal);
      if (cardId) attachCardActivity({
        cardId,
        agentId: 'landos/documents',
        kind: 'document_updated',
        summary: `Operator updated document metadata for "${upload.title}".`,
        ref: `upload:${uploadId}`,
      });
      return c.json({ upload, uploads: listDocumentUploads(id) });
    } catch (error) {
      return c.json({ error: (error as Error).message }, 400);
    }
  });

  app.delete('/api/landos/deal-cards/:id/documents/uploads/:uploadId', (c) => {
    const id = Number(c.req.param('id'));
    const uploadId = Number(c.req.param('uploadId'));
    const deal = Number.isInteger(id) && Number.isInteger(uploadId) ? getDealCard(id) : undefined;
    if (!deal) return c.json({ error: 'document not found' }, 404);
    const removed = removeDocumentUpload(id, uploadId);
    if (!removed) return c.json({ error: 'document not found' }, 404);
    const cardId = subjectCardId(deal);
    if (cardId) attachCardActivity({
      cardId,
      agentId: 'landos/documents',
      kind: 'document_deleted',
      summary: `Operator removed "${removed.title}" from this Deal Card.`,
      ref: `upload:${uploadId}`,
    });
    landosAudit('landos/documents', 'document_deleted', `deal ${id}: ${removed.title}`, {
      refTable: 'landos_deal_card',
      refId: id,
    });
    return c.json({ deleted: true, uploadId, uploads: listDocumentUploads(id) });
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
    const abs = landosArtifactPath('visuals', file);
    if (!fs.existsSync(abs)) return c.json({ error: 'document page not found' }, 404);
    const bytes = fs.readFileSync(abs);
    const ext = path.extname(file).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    return c.body(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, 200, {
      'Content-Type': mime,
      'Cache-Control': 'private, max-age=3600',
    });
  });

  // ── Post-discovery DD layer ─────────────────────────────────────────────
  // Resolve the deal's SUBJECT property card id (seller facts + county records
  // are stored on it). undefined when no property card is linked yet.
  const subjectCardId = (deal: unknown): number | undefined =>
    resolveSubjectPropertyCard(deal).cardId ?? undefined;

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
  const acqView = (id: number, options: { includeDeepWorkspaceData?: boolean } = {}) => {
    const acq = getAcquisition(id);
    const report = getDealCardReport(id);
    const deal = getDealCard(id);
    const propertyCardId = deal ? subjectCardId(deal) : null;
    const na = acquisitionNextAction(acq, { ddParcelVerified: report.parcelVerified });
    const core = {
      acquisition: acq,
      stageLabel: ACQUISITION_STAGE_LABEL[acq.stage],
      nextAction: na,
      strategy: sellerStrategySummary(acq, na),
      callPrep: buildCallPrep(acq, na, acqContext(id)),
      playbook: acquisitionPlaybook(),
      trainingReadiness: acquisitionTrainingReadiness(),
    };
    if (options.includeDeepWorkspaceData === false) return core;
    const inspection = propertyCardId ? loadPropertyInspection(propertyCardId) : null;
    return {
      ...core,
      canonicalState: canonicalDealStateFor(id),
      subjectListing: propertyCardId ? loadSubjectListingDetail(propertyCardId) : null,
      landPortalFacts: inspection ? buildParcelFactSheet(inspection.parcelFacts) : null,
      marketContext: deal ? marketContextFor(deal) : null,
      compsValuation: buildCompsValuationView(id),
    };
  };
  app.get('/api/landos/deal-cards/:id/acquisition', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    if (!getDealCard(id)) return c.json({ error: 'deal card not found' }, 404);
    return c.json(acqView(id, {
      includeDeepWorkspaceData: c.req.query('view') !== 'workspace-v2-overview',
    }));
  });
  app.post('/api/landos/deal-cards/:id/acquisition/profile', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || !getDealCard(id)) return c.json({ error: 'deal card not found' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    upsertSellerProfile(id, (body.profile ?? body) as Record<string, never>);
    const cardId = subjectCardId(getDealCard(id)!);
    if (cardId) {
      attachCardActivity({
        cardId,
        agentId: 'landos/acquisitions',
        kind: 'seller_profile_updated',
        summary: 'Seller and CRM details were updated on the Deal Card.',
      });
    }
    return c.json(acqView(id), 201);
  });
  app.post('/api/landos/deal-cards/:id/acquisition/comm', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || !getDealCard(id)) return c.json({ error: 'deal card not found' }, 404);
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const channel = (COMM_CHANNELS as readonly string[]).includes(str(b.channel) ?? '') ? (b.channel as CommChannel) : 'other';
    const communicationType = str(b.type);
    if (communicationType && !['call', 'text', 'email', 'note', 'transcript'].includes(communicationType)) {
      return c.json({ error: 'invalid communication type' }, 400);
    }
    if (!str(b.summary)) return c.json({ error: 'summary is required' }, 400);
    addCommLogEntry(id, {
      type: communicationType as 'call' | 'text' | 'email' | 'note' | 'transcript' | undefined,
      at: str(b.at) ?? new Date().toISOString(), channel,
      direction: b.direction === 'inbound' ? 'inbound' : 'outbound',
      summary: str(b.summary)!, notes: str(b.notes),
      body: str(b.body), subject: str(b.subject),
      outcome: str(b.outcome),
      followUpDate: str(b.followUpDate),
      sentiment: (str(b.sentiment) as never) ?? 'unknown',
      keyFacts: Array.isArray(b.keyFacts) ? (b.keyFacts as string[]) : [],
      objections: Array.isArray(b.objections) ? (b.objections as string[]) : [],
      commitments: Array.isArray(b.commitments) ? (b.commitments as string[]) : [],
      followUpNeeded: b.followUpNeeded === true,
    });
    const cardId = subjectCardId(getDealCard(id)!);
    if (cardId) {
      attachCardActivity({
        cardId,
        agentId: 'landos/acquisitions',
        kind: 'communication_added',
        summary: `${b.direction === 'inbound' ? 'Inbound' : 'Outbound'} ${String(channel).replace(/_/g, ' ')} recorded: ${str(b.summary)!.slice(0, 180)}`,
      });
    }
    return c.json(acqView(id), 201);
  });

  app.patch('/api/landos/deal-cards/:id/acquisition/comm/:commId', async (c) => {
    const id = Number(c.req.param('id'));
    const commId = decodeURIComponent(c.req.param('commId'));
    if (!Number.isInteger(id) || !getDealCard(id)) return c.json({ error: 'deal card not found' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const channel = str(body.channel);
    if (channel && !(COMM_CHANNELS as readonly string[]).includes(channel)) return c.json({ error: 'invalid channel' }, 400);
    const direction = str(body.direction);
    if (direction && !['inbound', 'outbound'].includes(direction)) return c.json({ error: 'invalid direction' }, 400);
    const communicationType = str(body.type);
    if (communicationType && !['call', 'text', 'email', 'note', 'transcript'].includes(communicationType)) {
      return c.json({ error: 'invalid communication type' }, 400);
    }
    const updated = updateCommLogEntry(id, commId, {
      type: communicationType as 'call' | 'text' | 'email' | 'note' | 'transcript' | undefined,
      at: str(body.at),
      channel: channel as CommChannel | undefined,
      direction: direction as 'inbound' | 'outbound' | undefined,
      summary: str(body.summary),
      notes: str(body.notes),
      body: str(body.body), subject: str(body.subject),
      outcome: str(body.outcome),
      followUpDate: str(body.followUpDate),
      followUpNeeded: body.followUpNeeded === undefined ? undefined : body.followUpNeeded === true,
    });
    if (!updated) return c.json({ error: 'communication not found' }, 404);
    const cardId = subjectCardId(getDealCard(id)!);
    if (cardId) attachCardActivity({
      cardId,
      agentId: 'landos/acquisitions',
      kind: 'communication_updated',
      summary: `Communication updated: ${str(body.summary)?.slice(0, 180) ?? commId}.`,
      ref: `communication:${commId}`,
    });
    return c.json(acqView(id));
  });

  app.delete('/api/landos/deal-cards/:id/acquisition/comm/:commId', (c) => {
    const id = Number(c.req.param('id'));
    const commId = decodeURIComponent(c.req.param('commId'));
    if (!Number.isInteger(id) || !getDealCard(id)) return c.json({ error: 'deal card not found' }, 404);
    const updated = deleteCommLogEntry(id, commId);
    if (!updated) return c.json({ error: 'communication not found' }, 404);
    const cardId = subjectCardId(getDealCard(id)!);
    if (cardId) attachCardActivity({
      cardId,
      agentId: 'landos/acquisitions',
      kind: 'communication_deleted',
      summary: 'Communication removed from this Deal Card.',
      ref: `communication:${commId}`,
    });
    return c.json(acqView(id));
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
    const cardId = subjectCardId(getDealCard(id)!);
    if (cardId) {
      attachCardActivity({
        cardId,
        agentId: 'landos/acquisitions',
        kind: stage === 'ready_for_offer_prep' ? 'offer_started' : 'stage_advanced',
        summary: stage === 'ready_for_offer_prep'
          ? 'Offer preparation started from the Deal Card.'
          : `CRM stage advanced to ${ACQUISITION_STAGE_LABEL[stage as AcquisitionStage]}.`,
      });
    }
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
    const status = str(body.status) as CompStatus | undefined;
    const priceKind = str(body.priceKind) as CompPriceKind | undefined;
    // A row marked as a verified sale must be reproducible from its source,
    // otherwise it stays a market reference instead of leaking into pricing.
    if (status === 'verified_sale' && (!str(body.sourceUrl) || !str(body.addressDesc) || num(body.price) == null || num(body.acres) == null || !str(body.saleOrListDate) || priceKind !== 'sale')) {
      return c.json({ error: 'A verified sale needs its source link, property, sale price, sale date, acreage, and a closed-sale classification.' }, 400);
    }
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
      priceKind,
      saleOrListDate: str(body.saleOrListDate),
      acres: num(body.acres),
      pricePerAcre: num(body.pricePerAcre),
      notes: str(body.notes),
      addedBy: str(body.addedBy),
      status,
      lat: num(body.lat),
      lng: num(body.lng),
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
    let exactResolve: LpResolveResult | null = null;
    const capability = await runToolsPropertyResolution({
      rawInput: text,
      entity: isEntity(body.entity) ? body.entity : 'TY_LAND_BIZ',
      refresh: body.refresh === true,
    }, {
      exactCompatibility: true,
      onExactResolve: (result) => { exactResolve = result; },
    });
    const canonical = (capability.facts.canonicalIdentity ?? {}) as Record<string, unknown>;
    const parcelVerified = capability.subjectResolution === 'RESOLVED';
    const capabilityVerification: DukeVerificationResult = {
      status: parcelVerified ? 'parcel_verified' : 'unverified',
      parcelVerified,
      ...(parcelVerified ? {
        verificationSource: capability.evidence[0]?.source ?? 'LandOS Property Resolution Capability',
        identity: {
          apn: str(canonical.apn), fips: str(canonical.fips), propertyId: str(canonical.landPortalPropertyId),
          situsAddress: str(canonical.address), city: str(canonical.city), county: str(canonical.county),
          state: str(canonical.state), owner: str(canonical.owner), acres: num(canonical.acres),
        },
      } : {}),
      sourceAttempts: capability.evidence.map((item) => ({
        source: item.source,
        status: parcelVerified ? 'verified' as const : 'not_verified' as const,
        reason: str(capability.facts.identityBasis) ?? capability.subjectResolution,
        truthLabel: parcelVerified ? 'verified_fact' as const : 'attempted_lookup' as const,
      })),
      dataGaps: capability.missingInformation,
      nextAction: capability.missingInformation.join('; ') || undefined,
      localAreaContextLabel: parcelVerified ? undefined : 'Local Area Context — Not Parcel Verified',
      marketPulseEligible: parcelVerified,
      strategyUnderwritingBlocked: !parcelVerified,
      summary: str(capability.facts.identityBasis) ?? `Property Resolution returned ${capability.subjectResolution}.`,
      executionMode: 'duke_verification_read_only',
    };
    const exactVerification = await runDukeVerification(text, {
      resolve: async () => {
        if (!exactResolve) throw new Error('Exact provider returned no result inside Property Resolution.');
        return exactResolve;
      },
      timeoutMs: LANDPORTAL_VERIFICATION_TIMEOUT_MS,
    });
    const verification = capability.subjectResolution === 'RESOLVED'
      ? exactVerification.parcelVerified ? exactVerification : capabilityVerification
      : {
        ...capabilityVerification,
        sourceAttempts: exactVerification.sourceAttempts.map((attempt) => ({
          ...attempt,
          status: attempt.status === 'verified' ? 'not_verified' as const : attempt.status,
          reason: attempt.status === 'verified' ? capabilityVerification.summary : attempt.reason,
          truthLabel: 'attempted_lookup' as const,
        })),
        dataGaps: exactVerification.dataGaps.length ? exactVerification.dataGaps : capabilityVerification.dataGaps,
        nextAction: exactVerification.nextAction ?? capabilityVerification.nextAction,
        marketPulseEligible: exactVerification.marketPulseEligible,
      };
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
    const verifiedId = verification.propertyData?.identity ?? verification.identity;
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
    return c.json({ capability, verification, dukeAnalysis, acePrep, marketPulse, dealCardUpdatePlan, landScore, imagery });
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
    const capability = await runToolsPropertyResolution({ rawInput: text, entity, refresh: body.refresh === true });
    const parcelVerified = capability.subjectResolution === 'RESOLVED';

    // This legacy conversion URL is now research-only. Creating a CRM record
    // belongs to New Lead, whose raw-target capability transition owns identity.
    if (!parcelVerified) {
      const area = extractAreaSignals(text);
      const marketPulse = buildMarketPulseV1({
        city: area.city,
        county: area.county,
        state: area.state,
        parcelVerified: false,
      });
      return c.json({
        created: false,
        parcelVerified: false,
        reason: 'Local Area Context — Not Parcel Verified', capability,
        marketPulse,
      });
    }
    return c.json({
      created: false,
      parcelVerified: true,
      reason: 'Property resolved. Create the CRM record through New Lead so canonical capability persistence remains authoritative.',
      capability,
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
    const capability = await runToolsPropertyResolution({
      rawInput: text,
      entity: isEntity(str(body.entity)) ? str(body.entity) : 'TY_LAND_BIZ',
      refresh: body.refresh === true,
    });
    return c.json({
      capability,
      result: {
        verified: capability.subjectResolution === 'RESOLVED',
        verdict: capability.subjectResolution,
        offerReadiness: 'blocked_until_new_lead',
        providerCallCount: capability.evidence.length,
        actualSpendUsd: 0,
        note: 'Legacy Property Analysis is now a Property Resolution research adapter. Create a New Lead to run downstream Deal Intelligence.',
      },
      report: { markdownPath: '', pdfPath: null, pdfReason: 'No report is created by one-off property research.' },
    });
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
  async function runToolsPropertyResolution(
    body: Record<string, unknown>,
    options: { exactCompatibility?: boolean; onExactResolve?: (result: LpResolveResult) => void } = {},
  ) {
    const rawInput = str(body.rawInput) ?? str(body.text);
    if (!rawInput?.trim()) throw new Error('rawInput is required');
    const entity = isEntity(body.entity) ? body.entity : 'TY_LAND_BIZ';
    const exactArgs = options.exactCompatibility ? extractPropertyArgs(rawInput) : null;
    return invokeRuntimeCapability({
      capabilityId: PROPERTY_RESOLUTION_CAPABILITY_ID,
      caller: { type: 'tools', ref: 'tools:property-resolver' },
      subject: { kind: 'raw_property', entity, rawInput: rawInput.trim() },
      mode: body.refresh === true ? 'refresh' : 'reuse',
      context: { surface: 'tools', tool: 'property-resolver' },
    }, {
      universalOptions: {
        ...(exactArgs ? { lanes: { landportal: async () => {
          try {
            const resolved = await lpResolveForPreflight(exactArgs, LANDPORTAL_VERIFICATION_TIMEOUT_MS);
            options.onExactResolve?.(resolved);
            if (!resolved.verified) {
              return {
                lane: 'landportal' as const,
                status: 'no_evidence' as const,
                note: resolved.match_notes ?? `Exact lookup returned ${resolved.status}.`,
                source: { label: resolved.source ?? 'LandPortal exact lookup', url: null, officiality: 'officially_linked' as const },
              };
            }
            const summary = resolved.property_summary;
            const acres = Number(summary?.lot_size_acres ?? summary?.calc_acres);
            return {
              lane: 'landportal' as const,
              status: 'evidence' as const,
              note: resolved.match_notes ?? 'Exact parcel identity returned.',
              patch: {
                apn: resolved.apn ?? summary?.apn,
                fips: resolved.fips,
                lpPropertyId: resolved.propertyid ?? summary?.propertyid,
                address: resolved.situs_address ?? summary?.situs_address,
                city: resolved.city ?? summary?.city,
                county: summary?.county,
                state: resolved.state ?? summary?.state,
                zip: summary?.zip,
                owner: resolved.owner ?? summary?.owner,
                acres: Number.isFinite(acres) && acres > 0 ? acres : null,
                verified: true,
                verificationSource: resolved.source ?? 'LandPortal exact lookup',
              },
              source: { label: resolved.source ?? 'LandPortal exact lookup', url: null, officiality: 'officially_linked' as const },
            };
          } catch (error) {
            return {
              lane: 'landportal' as const,
              status: 'error' as const,
              note: error instanceof Error ? error.message : 'Exact parcel lookup failed.',
              source: { label: 'LandPortal exact lookup', url: null, officiality: 'officially_linked' as const },
            };
          }
        } } } : {}),
        ...(!options.exactCompatibility ? {
          indexedWeb: {
            search: createHermesFreeSearch(),
            fetchText: defaultGovFetchText,
            maxQueries: 3,
            maxPages: 3,
            timeoutMs: 20_000,
          },
          jurisdiction: { timeoutMs: 15_000 },
        } : {}),
        deadlineMs: 65_000,
      },
    });
  }

  app.get('/api/landos/capabilities', (c) => c.json({ capabilities: listRuntimeCapabilities() }));

  app.post('/api/landos/capabilities/property-resolution/invoke', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    try { return c.json({ result: await runToolsPropertyResolution(body) }); }
    catch (error) { return c.json({ error: error instanceof Error ? error.message : String(error) }, 400); }
  });

  // Tools → Assessor & Tax. Property Resolution establishes the subject first;
  // the Assessor & Tax Capability is then handed that exact canonical subject
  // rather than resolving anything of its own. A Tools run is research: it
  // never creates a Deal Card, a Property Card, or a CRM lead.
  app.post('/api/landos/capabilities/assessor-tax/invoke', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const rawInput = str(body.rawInput) ?? str(body.text);
    if (!rawInput?.trim()) return c.json({ error: 'rawInput is required' }, 400);
    const entity = isEntity(body.entity) ? body.entity : 'TY_LAND_BIZ';
    const refresh = body.refresh === true;
    try {
      const resolution = await runToolsPropertyResolution(body);
      const result = await invokeRuntimeCapability({
        capabilityId: ASSESSOR_TAX_CAPABILITY_ID,
        caller: { type: 'tools', ref: 'tools:assessor-tax' },
        subject: { kind: 'raw_property', entity, rawInput: rawInput.trim() },
        mode: refresh ? 'refresh' : 'reuse',
        context: { surface: 'tools', tool: 'assessor-tax' },
      }, { resolveSubject: async () => resolution });
      return c.json({ resolution, result });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  // Tools → LandPortal Research. Property Resolution establishes the subject
  // first; the LandPortal Research Capability is then handed that exact
  // canonical subject rather than resolving anything of its own. A Tools run is
  // research: it never creates a Deal Card, a Property Card, or a CRM lead.
  app.post('/api/landos/capabilities/landportal-research/invoke', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const rawInput = str(body.rawInput) ?? str(body.text);
    if (!rawInput?.trim()) return c.json({ error: 'rawInput is required' }, 400);
    const entity = isEntity(body.entity) ? body.entity : 'TY_LAND_BIZ';
    const refresh = body.refresh === true;
    try {
      const resolution = await runToolsPropertyResolution(body);
      const result = await invokeRuntimeCapability({
        capabilityId: LANDPORTAL_RESEARCH_CAPABILITY_ID,
        caller: { type: 'tools', ref: 'tools:landportal-research' },
        subject: { kind: 'raw_property', entity, rawInput: rawInput.trim() },
        mode: refresh ? 'refresh' : 'reuse',
        parameters: { lane: 'parcel_facts' },
        context: { surface: 'tools', tool: 'landportal-research' },
      }, { resolveSubject: async () => resolution });
      return c.json({ resolution, result });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  // Tools → Comps & Valuation. Property Resolution establishes the subject
  // first; the Comps & Valuation Capability is then handed that exact canonical
  // subject rather than resolving anything of its own. A Tools run is research:
  // it never creates a Deal Card, a Property Card, or a CRM lead, so a subject
  // LandOS holds no canonical property for reports honestly that it retains no
  // comparable evidence instead of manufacturing a card to hold some.
  app.post('/api/landos/capabilities/comps-valuation/invoke', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const rawInput = str(body.rawInput) ?? str(body.text);
    if (!rawInput?.trim()) return c.json({ error: 'rawInput is required' }, 400);
    const entity = isEntity(body.entity) ? body.entity : 'TY_LAND_BIZ';
    const refresh = body.refresh === true;
    try {
      const resolution = await runToolsPropertyResolution(body);
      const result = await invokeRuntimeCapability({
        capabilityId: COMPS_VALUATION_CAPABILITY_ID,
        caller: { type: 'tools', ref: 'tools:comps-valuation' },
        subject: { kind: 'raw_property', entity, rawInput: rawInput.trim() },
        mode: refresh ? 'refresh' : 'reuse',
        parameters: { lane: 'retained_valuation' },
        context: { surface: 'tools', tool: 'comps-valuation' },
      }, { resolveSubject: async () => resolution });
      return c.json({ resolution, result });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  // Tools → Zoning & Subdivision. Property Resolution establishes the subject
  // first; the Zoning & Subdivision Capability is handed that exact canonical
  // subject. A Tools run is research: it never creates a Deal Card, a Property
  // Card, or a CRM lead, so a subject LandOS holds no canonical property for
  // reports honestly that it retains no land-use rules for it.
  app.post('/api/landos/capabilities/zoning-subdivision/invoke', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const rawInput = str(body.rawInput) ?? str(body.text);
    if (!rawInput?.trim()) return c.json({ error: 'rawInput is required' }, 400);
    const entity = isEntity(body.entity) ? body.entity : 'TY_LAND_BIZ';
    const refresh = body.refresh === true;
    try {
      const resolution = await runToolsPropertyResolution(body);
      const result = await invokeRuntimeCapability({
        capabilityId: ZONING_SUBDIVISION_CAPABILITY_ID,
        caller: { type: 'tools', ref: 'tools:zoning-subdivision' },
        subject: { kind: 'raw_property', entity, rawInput: rawInput.trim() },
        mode: refresh ? 'refresh' : 'reuse',
        parameters: { lane: body.research === true ? 'research' : 'retained_rules' },
        context: { surface: 'tools', tool: 'zoning-subdivision' },
      }, { resolveSubject: async () => resolution, runLandUseResearch: landUseResearchLane });
      return c.json({ resolution, result });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  // Tools → Property Development History. Same subject contract, different
  // business question: what has happened to THIS parcel. The capability
  // consumes the context LandOS already retained before any bounded search.
  app.post('/api/landos/capabilities/property-development-history/invoke', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const rawInput = str(body.rawInput) ?? str(body.text);
    if (!rawInput?.trim()) return c.json({ error: 'rawInput is required' }, 400);
    const entity = isEntity(body.entity) ? body.entity : 'TY_LAND_BIZ';
    const refresh = body.refresh === true;
    try {
      const resolution = await runToolsPropertyResolution(body);
      const result = await invokeRuntimeCapability({
        capabilityId: PROPERTY_DEVELOPMENT_HISTORY_CAPABILITY_ID,
        caller: { type: 'tools', ref: 'tools:property-development-history' },
        subject: { kind: 'raw_property', entity, rawInput: rawInput.trim() },
        mode: refresh ? 'refresh' : 'reuse',
        parameters: { lane: body.research === true ? 'research' : 'retained_history' },
        context: { surface: 'tools', tool: 'property-development-history' },
      }, { resolveSubject: async () => resolution, runHistorySearch: propertyHistoryLane });
      return c.json({ resolution, result });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  // ── The LandPortal three-tool split ───────────────────────────────────────
  // Property Characteristics, Visual Capture and Comp Search are separately
  // callable capabilities with separate run states/results. Each ensures its
  // own LandPortal authentication, runs on the dedicated LandOS browser, and
  // closes every page it opened. Callable against a Deal Card subject
  // (`{ dealCardId }`) or raw Tools input (`{ rawInput }`).
  type LandPortalToolSubjectSpec =
    | { kind: 'canonical_property'; entity: LandosEntity; propertyCardId: number; dealCardId: number }
    | { kind: 'raw_property'; entity: LandosEntity; rawInput: string };
  const landPortalToolSubject = (body: Record<string, unknown>): { subject: LandPortalToolSubjectSpec } | { error: string } => {
    const dealCardId = Number(body.dealCardId);
    if (Number.isFinite(dealCardId) && dealCardId > 0) {
      const retained = readResolverSubject(dealCardId);
      if (!retained?.propertyCardId) return { error: `Deal Card ${dealCardId} has no subject property card` };
      return { subject: { kind: 'canonical_property', entity: retained.entity, propertyCardId: retained.propertyCardId, dealCardId } };
    }
    const rawInput = str(body.rawInput) ?? str(body.text);
    if (!rawInput?.trim()) return { error: 'dealCardId or rawInput is required' };
    const entity = isEntity(body.entity) ? body.entity : 'TY_LAND_BIZ';
    return { subject: { kind: 'raw_property', entity, rawInput: rawInput.trim() } };
  };
  interface LandPortalToolContext {
    req: { json: () => Promise<unknown> };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    json: (data: any, status?: any) => any;
  }
  const invokeLandPortalTool = async (
    c: LandPortalToolContext,
    capabilityId: string,
    tool: string,
    runtimeFor: (driver: ReturnType<typeof makeLiveBrowserDriver>, subject: LandPortalToolSubjectSpec) => Record<string, unknown>,
  ) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const parsed = landPortalToolSubject(body);
    if ('error' in parsed) return c.json({ error: parsed.error }, 400);
    const refresh = body.refresh !== false; // live browser tools default to a fresh run
    const driver = makeLiveBrowserDriver('landportal');
    let scopeToken: string | null = null;
    let cleanup: { closed: number; failed: number; preserved: number } | null = null;
    try {
      const auth = await ensureLandPortalAuthenticated();
      scopeToken = driver.beginOwnedPageScope ? await driver.beginOwnedPageScope() : null;
      let resolveSubject: (() => Promise<unknown>) | undefined;
      if (parsed.subject.kind === 'raw_property') {
        const resolution = await runToolsPropertyResolution(body);
        resolveSubject = async () => resolution;
      }
      const result = await invokeRuntimeCapability({
        capabilityId,
        caller: { type: parsed.subject.kind === 'canonical_property' ? 'deal_card' : 'tools', ref: `tools:${tool}` },
        subject: parsed.subject,
        mode: refresh ? 'refresh' : 'reuse',
        ...(Array.isArray(body.captureLabels) ? { parameters: { captureLabels: body.captureLabels.map(String) } } : {}),
        context: { surface: 'tools', tool },
      }, {
        ...(resolveSubject ? { resolveSubject } : {}),
        ...runtimeFor(driver, parsed.subject),
      } as Parameters<typeof invokeRuntimeCapability>[1]);
      return c.json({ auth: { phase: auth.phase, authenticated: auth.authenticated }, result, cleanup });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    } finally {
      if (scopeToken && driver.closeOwnedPageScope) {
        try { cleanup = await driver.closeOwnedPageScope(scopeToken); } catch { cleanup = null; }
      }
    }
  };
  /** Zillow/Realtor adapters share the subject's locality read. */
  const landPortalToolLocality = (subject: LandPortalToolSubjectSpec) => {
    if (subject.kind !== 'canonical_property') return null;
    const retained = readResolverSubject(subject.dealCardId);
    if (!retained) return null;
    return {
      city: retained.city ?? undefined,
      state: retained.state ?? undefined,
      zip: retained.zip ?? undefined,
      county: retained.county ?? undefined,
      lat: retained.lat ?? undefined,
      lng: retained.lng ?? undefined,
      subjectAcres: retained.acres,
    };
  };

  app.post('/api/landos/capabilities/landportal-property-characteristics/invoke', (c) =>
    invokeLandPortalTool(c, LANDPORTAL_PROPERTY_CHARACTERISTICS_CAPABILITY_ID, 'landportal-property-characteristics', (driver) => ({
      readRecord: (url: string, opts: { timeoutMs: number; includeMls?: boolean }) => driver.readLandPortalRecord!(url, opts),
    })));

  app.post('/api/landos/capabilities/landportal-visual-capture/invoke', (c) =>
    invokeLandPortalTool(c, LANDPORTAL_VISUAL_CAPTURE_CAPABILITY_ID, 'landportal-visual-capture', (driver) => ({
      captureVisuals: async (url: string, opts: { timeoutMs: number; captureLabels: string[] }) => {
        const capture = await driver.captureLandPortalVisuals!(url, opts);
        return {
          fields: capture.fields,
          visualShots: capture.visualShots,
          overlayMisses: capture.overlayMisses,
          capturedAtIso: capture.capturedAtIso,
        };
      },
    })));

  app.post('/api/landos/capabilities/landportal-comp-search/invoke', (c) =>
    invokeLandPortalTool(c, LANDPORTAL_COMP_SEARCH_CAPABILITY_ID, 'landportal-comp-search', (driver, subject) => ({
      runMapSearch: (url: string, plan: Parameters<NonNullable<typeof driver.runLandPortalMapSearch>>[1], opts: { timeoutMs: number }) =>
        driver.runLandPortalMapSearch!(url, plan, opts),
      readCompRecord: (url: string, opts: { timeoutMs: number; includeMls?: boolean }) => driver.readLandPortalRecord!(url, opts),
      // The sold period the capability asks for: 12 months on the first pass,
      // 24 only when it deliberately expanded on insufficient recent evidence.
      // Never a price bound.
      zillowSearch: async (mode: 'sold' | 'active', dateWindowMonths?: SoldSearchWindowMonths): Promise<SecondarySearchResult> => {
        const locality = landPortalToolLocality(subject);
        if (!locality?.state) return { status: 'disabled', comps: [], note: 'No subject locality available for the Zillow flow.' };
        const zillow = await fetchZillowLandComps({ ...locality, mode, propertyType: 'land', dateWindowMonths: dateWindowMonths ?? RECENT_SALE_WINDOW_MONTHS });
        return {
          status: zillow.status,
          note: zillow.note,
          comps: zillow.comps.map((row) => ({
            address: row.address,
            price: row.price,
            acres: row.acres,
            status: row.status === 'sold' ? 'sold' as const : row.status === 'active' ? 'for_sale' as const : 'unknown' as const,
            url: row.url,
            soldDate: row.soldDate ?? null,
            lat: row.lat ?? null,
            lng: row.lng ?? null,
            homeSizeSqft: row.homeSizeSqft ?? null,
          })),
        };
      },
      redfinSearch: async (mode: 'sold' | 'active', dateWindowMonths?: SoldSearchWindowMonths): Promise<SecondarySearchResult> => {
        const locality = landPortalToolLocality(subject);
        if (!locality?.state) return { status: 'disabled', comps: [], note: 'No subject locality available for the Redfin flow.' };
        const redfin = await fetchRedfinLandComps({ ...locality, mode, dateWindowMonths: dateWindowMonths ?? RECENT_SALE_WINDOW_MONTHS });
        return {
          status: redfin.status,
          note: redfin.note,
          comps: redfin.comps.map((row) => ({
            address: row.address,
            price: row.price,
            acres: row.acres,
            status: row.status === 'sold' ? 'sold' as const : row.status === 'active' ? 'for_sale' as const : 'unknown' as const,
            url: row.url,
            soldDate: row.soldDate ?? null,
            lat: row.lat ?? null,
            lng: row.lng ?? null,
            homeSizeSqft: row.homeSizeSqft ?? null,
            improvedHint: !!row.homeType,
          })),
        };
      },
      redfinDetail: async (url: string, opts: { timeoutMs: number }) => {
        const detail = await fetchRedfinListingDetail(url, { timeoutMs: opts.timeoutMs });
        return {
          status: detail.status,
          remarks: detail.remarks,
          yearBuilt: detail.yearBuilt,
          buildingSqft: detail.buildingSqft,
          lotAcres: detail.lotAcres,
          propertyType: detail.propertyType,
          utilityStatements: detail.utilityStatements,
          priorEvents: detail.priorEvents,
          note: detail.note,
        };
      },
      landwatchSearch: async (): Promise<SecondarySearchResult> => {
        const locality = landPortalToolLocality(subject);
        if (!locality?.state || !locality.county) return { status: 'disabled', comps: [], note: 'No subject county + state available for the LandWatch fallback.' };
        const landwatch = await fetchLandWatchLandComps({
          county: locality.county, state: locality.state, subjectAcres: locality.subjectAcres, mode: 'sold',
        });
        return {
          status: landwatch.status,
          note: landwatch.note,
          comps: landwatch.comps.map((row) => ({
            address: row.address,
            price: row.price,
            acres: row.acres,
            status: row.status === 'sold' ? 'sold' as const : 'for_sale' as const,
            url: row.url,
            soldDate: row.soldDate,
            improvedHint: row.improvedHint,
            remark: row.remark,
          })),
        };
      },
      realtorSearch: async (): Promise<SecondarySearchResult> => {
        const locality = landPortalToolLocality(subject);
        if (!locality?.state) return { status: 'disabled', comps: [], note: 'No subject locality available for the Realtor.com fallback.' };
        const realtor = await fetchRealtorLandComps({
          city: locality.city, state: locality.state, zip: locality.zip, county: locality.county,
          subjectAcres: locality.subjectAcres, mode: 'sold',
        });
        return {
          status: realtor.status,
          note: realtor.note,
          comps: realtor.comps.map((row) => ({
            address: row.address,
            price: row.price,
            acres: row.acres,
            status: row.status === 'sold' ? 'sold' as const : row.status === 'active' ? 'for_sale' as const : 'unknown' as const,
            url: row.url,
            soldDate: row.soldDate ?? null,
            homeSizeSqft: row.homeSizeSqft ?? null,
          })),
        };
      },
    })));

  // Compatibility URL. It is now only an adapter over the canonical Capability.
  app.post('/api/landos/property/resolve', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    try { return c.json({ resolution: await runToolsPropertyResolution(body) }); }
    catch (error) { return c.json({ error: error instanceof Error ? error.message : String(error) }, 400); }
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

  // Versioned Property Summary read model. GET is intentionally SELECT-only:
  // it performs no provider work, legacy reconciliation, valuation, or write.
  app.get('/api/landos/deal-cards/:id/property-summary', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    if (!getDealCard(id)) return c.json({ error: 'deal card not found' }, 404);
    return c.json({ propertySummary: readPropertySummaryForDeal(id) });
  });

  // Explicit command boundary for adapting already-persisted legacy identity
  // and public assessor/GIS evidence into the versioned vertical slice.
  app.post('/api/landos/deal-cards/:id/property-summary/rebuild', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    if (!getDealCard(id)) return c.json({ error: 'deal card not found' }, 404);
    try {
      const propertySummary = synchronizePropertySummaryForDeal({
        dealCardId: id,
        actor: 'property-summary-command',
        changeReason: 'Operator requested a Property Summary rebuild from persisted evidence.',
      });
      return c.json({ propertySummary });
    } catch (error) {
      logger.warn({ err: error, dealCardId: id }, 'property_summary_rebuild_failed');
      return c.json({ error: (error as Error)?.message ?? 'Property Summary rebuild failed.' }, 409);
    }
  });

  // Shared public-intelligence mission runner — the SAME path whether the
  // operator clicks "run" or parcel confirmation auto-continues downstream.
  // Versioned Deed / Ownership / Survey / Encumbrance / Tax / Lien read model.
  // GET remains SELECT-only so opening a Deal Card cannot start research,
  // reconcile evidence, invoke the Analyst, scan files, or write snapshots.
  app.get('/api/landos/deal-cards/:id/government-records', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    if (!getDealCard(id)) return c.json({ error: 'deal card not found' }, 404);
    return c.json({ governmentRecords: readGovernmentRecordsForDeal(id) });
  });

  // Explicit Operator command: adapt already-persisted official outcomes and
  // retained documents into append-only claims and a pure Analyst snapshot.
  app.post('/api/landos/deal-cards/:id/government-records/rebuild', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    if (!getDealCard(id)) return c.json({ error: 'deal card not found' }, 404);
    try {
      const governmentRecords = synchronizeGovernmentRecordsForDeal({
        dealCardId: id,
        actor: 'government-records-command',
        changeReason: 'Operator rebuilt the recorded-government screening snapshot from persisted official evidence and retained artifacts.',
      });
      return c.json({ governmentRecords });
    } catch (error) {
      logger.warn({ err: error, dealCardId: id }, 'government_records_rebuild_failed');
      return c.json({ error: (error as Error)?.message ?? 'Government-record screening rebuild failed.' }, 409);
    }
  });

  app.get('/api/landos/deal-cards/:id/government-records/artifacts/:artifactId/page/:page', (c) => {
    const id = Number(c.req.param('id'));
    const artifactId = Number(c.req.param('artifactId'));
    const pageNumber = Number(c.req.param('page'));
    if (!Number.isInteger(id) || !Number.isInteger(artifactId) || !Number.isInteger(pageNumber) || pageNumber < 1) {
      return c.json({ error: 'invalid artifact page' }, 400);
    }
    if (!getDealCard(id)) return c.json({ error: 'deal card not found' }, 404);
    const artifact = resolveGovernmentRecordArtifactPage({ dealCardId: id, artifactId, pageNumber });
    if (!artifact) return c.json({ error: 'artifact page not found' }, 404);
    const bytes = fs.readFileSync(artifact.path);
    // HTTP header values are ByteStrings. A display name carrying any
    // non-latin-1 character — an em dash out of an ordinance title is enough —
    // throws while building the response, and the operator gets a 500 for an
    // artifact sitting on disk perfectly intact. RFC 6266: an ASCII fallback
    // in `filename`, the real name in `filename*`.
    const asciiName = artifact.displayName.replace(/"/g, '').replace(/[^\x20-\x7E]/g, '_');
    return c.body(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, 200, {
      'Content-Type': artifact.mimeType,
      'Content-Disposition': `inline; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(artifact.displayName)}`,
      'Cache-Control': 'private, max-age=3600',
    });
  });

  // Versioned Jurisdiction / Zoning / Land-Use read model. GET remains
  // SELECT-only so opening a Deal Card cannot start zoning research, query a
  // boundary or zoning layer, retrieve an ordinance, invoke the Analyst, or
  // write snapshots.
  app.get('/api/landos/deal-cards/:id/zoning-land-use', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    if (!getDealCard(id)) return c.json({ error: 'deal card not found' }, 404);
    return c.json({ zoningLandUse: readZoningLandUseForDeal(id) });
  });

  // Explicit Operator command: live jurisdiction determination, official
  // zoning-map and ordinance retrieval, and one versioned Analyst snapshot.
  app.post('/api/landos/deal-cards/:id/zoning-land-use/rebuild', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    if (!getDealCard(id)) return c.json({ error: 'deal card not found' }, 404);
    try {
      const zoningLandUse = await synchronizeZoningLandUseForDeal({
        dealCardId: id,
        actor: 'zoning-command',
        changeReason: 'Operator rebuilt the jurisdiction/zoning/land-use snapshot from official sources.',
      });
      return c.json({ zoningLandUse });
    } catch (error) {
      logger.warn({ err: error, dealCardId: id }, 'zoning_land_use_rebuild_failed');
      return c.json({ error: (error as Error)?.message ?? 'Zoning/land-use rebuild failed.' }, 409);
    }
  });

  app.get('/api/landos/deal-cards/:id/zoning-land-use/artifacts/:artifactId/page/:page', (c) => {
    const id = Number(c.req.param('id'));
    const artifactId = Number(c.req.param('artifactId'));
    const pageNumber = Number(c.req.param('page'));
    if (!Number.isInteger(id) || !Number.isInteger(artifactId) || !Number.isInteger(pageNumber) || pageNumber < 1) {
      return c.json({ error: 'invalid artifact page' }, 400);
    }
    if (!getDealCard(id)) return c.json({ error: 'deal card not found' }, 404);
    const artifact = resolveZoningArtifactPage({ dealCardId: id, artifactId, pageNumber });
    if (!artifact) return c.json({ error: 'artifact page not found' }, 404);
    const bytes = fs.readFileSync(artifact.path);
    // HTTP header values are ByteStrings. A display name carrying any
    // non-latin-1 character — an em dash out of an ordinance title is enough —
    // throws while building the response, and the operator gets a 500 for an
    // artifact sitting on disk perfectly intact. RFC 6266: an ASCII fallback
    // in `filename`, the real name in `filename*`.
    const asciiName = artifact.displayName.replace(/"/g, '').replace(/[^\x20-\x7E]/g, '_');
    return c.body(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, 200, {
      'Content-Type': artifact.mimeType,
      'Content-Disposition': `inline; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(artifact.displayName)}`,
      'Cache-Control': 'private, max-age=3600',
    });
  });

  // Official statewide parcel layers return the full parcel geometry, so a
  // county-filtered query routinely takes 30-60s under normal load. The former
  // 25s budget timed out on a healthy provider and the run then reported an
  // UNRESOLVED parcel that was in fact resolvable — an honest message about the
  // wrong thing. 60s still sits well inside the parcel-identity specialist's
  // 180s budget, so a genuinely dead provider is still caught quickly.
  const OFFICIAL_PARCEL_LOOKUP_TIMEOUT_MS = 60_000;

  const retainedBrowserGovernment = (
    inspection: ReturnType<typeof loadPropertyInspection>,
    locality?: { county?: string | null; state?: string | null },
  ) => {
    const rawSources = (inspection?.sources ?? []).filter((source) =>
      source.stage.startsWith('county_')
      || /county|assessor|appraiser|gis|recorder|deed|tax|planning|zoning|clerk/i.test(`${source.provider} ${source.stage}`))
      .filter((source) =>
        !isRejectedParcelRecordDestination(source.url)
        && !containsRejectedParcelRecordDestination(source.note))
      .filter((source) => !source.url
        || (officialDomainScore(source.url, locality?.county ?? undefined, locality?.state ?? undefined) > 0
          && !sourceContradictsRequestedState(
            { text: source.provider, href: source.url },
            locality?.county ?? undefined,
            locality?.state ?? undefined,
          )));
    const actualSources = rawSources.some((source) => source.provider !== 'County Records Browser')
      ? rawSources.filter((source) => source.provider !== 'County Records Browser')
      : rawSources;
    const attempts = actualSources
      .filter((source) => source.status !== 'not_attempted' && source.status !== 'not_configured')
      .map((source) => ({
        source: source.provider,
        url: source.url ?? null,
        status: source.resultKind ?? (source.status === 'used'
          ? 'retrieved' as const
          : source.status === 'fallback'
            ? 'useful_indication' as const
            : source.status === 'partial'
              ? 'attempted_inconclusive' as const
              : 'execution_failure' as const),
        note: source.note,
        attemptedAt: source.attemptedAt ?? undefined,
      }));
    const sourceNames = new Set(actualSources.map((source) => source.provider));
    const facts = (inspection?.evidence ?? [])
      .filter((item) => item.status === 'verified' && !!item.source && sourceNames.has(item.source))
      .map((item) => ({
        field: item.label,
        value: item.detail,
        source: item.source!,
        url: item.url ?? null,
        classification: /deed|recording|grantor|grantee|book.?page|instrument/i.test(item.label)
          ? 'recorded_instrument' as const
          : 'official_record' as const,
      }));
    return { attempts, facts };
  };

  const runPublicIntelligenceForDealCard = async (id: number, suppliedReportLanes?: ReportCompLanes | null): Promise<
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
    }, OFFICIAL_PARCEL_LOOKUP_TIMEOUT_MS);
    const reportLanes = suppliedReportLanes === undefined
      ? ((getDealCardReport(id).marketComps as unknown as ReportCompLanes) ?? null)
      : suppliedReportLanes;
    if (!lookup.parcel) {
      const retainedResolved = new PublicIntelligenceStore().loadLatestResolved(id);
      const retainedVerification = verificationFromStoredPublicIntelligence(retainedResolved);
      // A retained accepted identity may inform reconciliation, but it must not
      // short-circuit a new operator run. The former early return resurfaced an
      // older task graph and falsely reported newly connected soil/utility
      // collectors as "not run." Continue through the live discovery adapters
      // below and preserve retained identity fields only as fallback context.
      const requestedApn = str(property.apn);
      const acresValue = Number(property.acres);
      const propertyCardId = subjectCardId(deal);
      const inspection = propertyCardId ? loadPropertyInspection(propertyCardId) : null;
      const discovery = reconcileDiscoveryIdentity({
        subject: {
          address: str(property.active_input_address) ?? str(property.address),
          city: str(property.city),
          county: lookupCounty,
          state: str(property.state),
          zip: str(property.zip),
          apn: requestedApn,
          owner: str(property.owner),
          acres: Number.isFinite(acresValue) && acresValue > 0 ? acresValue : null,
        },
        landPortal: inspection ? {
          parcelUrl: inspection.parcelUrl,
          parcelFacts: inspection.parcelFacts,
          assetCount: inspection.assets.length,
          sourceLabel: 'LandPortal authenticated parcel panel',
          verifiedSubject: inspection.parcelUrlRecord?.verifiedSubject === true,
          verifiedSubjectApn: inspection.parcelUrlRecord?.apn ?? null,
          verifiedSubjectCounty: inspection.parcelUrlRecord?.verifiedCounty ?? null,
          verifiedSubjectState: inspection.parcelUrlRecord?.verifiedState ?? null,
        } : null,
        official: {
          status: lookup.status,
          source: lookup.attempted[0]?.source ?? 'Official public parcel lookup',
          note: lookup.attempted.map((attempt) => `${attempt.source}: ${attempt.note}`).join(' ') || 'The official parcel source did not return a usable result.',
          parcel: null,
        },
      });
      const cardLat = Number(
        property.lat
        ?? property.latitude
        ?? inspection?.parcelFacts['Centroid Latitude']
        ?? inspection?.parcelFacts.Latitude,
      );
      const cardLng = Number(
        property.lng
        ?? property.longitude
        ?? inspection?.parcelFacts['Centroid Longitude']
        ?? inspection?.parcelFacts.Longitude,
      );
      const cardCoordinates = Number.isFinite(cardLat) && Number.isFinite(cardLng)
        ? { lat: cardLat, lng: cardLng }
        : undefined;
      const canonicalSubject = resolveCanonicalIdentity(id);
      const subject: PublicIntelligenceSubject = {
        rawInput,
        normalizedAddress: str(discovery.patch.address) ?? retainedVerification?.identity?.situsAddress ?? str(property.address),
        county: str(discovery.patch.county) ?? retainedVerification?.identity?.county ?? lookupCounty,
        state: str(discovery.patch.state) ?? retainedVerification?.identity?.state ?? str(property.state),
        zip: str(discovery.patch.zip) ?? str(property.zip),
        requestedApn,
        resolvedApn: discovery.discoveryUsable
          ? str(discovery.patch.apn) ?? retainedVerification?.identity?.apn ?? requestedApn
          : retainedVerification?.identity?.apn ?? undefined,
        // The spine-established canonical identity is a parcel source (it is
        // minted only from APN+jurisdiction / LandPortal id+FIPS / an official
        // record), so a subject it establishes never re-enters screening as
        // "unresolved" merely because this discovery re-derivation found less.
        resolutionStatus: canonicalSubject.confirmed && discovery.state === 'unresolved'
          ? 'provisional'
          : discovery.state,
        discoveryUsable: discovery.discoveryUsable
          || (canonicalSubject.confirmed && discovery.state !== 'conflicted'),
        resolutionExplanation: canonicalSubject.confirmed && discovery.state === 'unresolved'
          ? canonicalSubject.basis
          : discovery.discoveryBasis,
        coordinates: discovery.patch.coordinates ?? cardCoordinates,
        assessedAcres: Number(discovery.patch.acres) > 0
          ? Number(discovery.patch.acres)
          : Number(retainedVerification?.identity?.acres) > 0
            ? Number(retainedVerification?.identity?.acres)
          : Number.isFinite(acresValue) && acresValue > 0 ? acresValue : undefined,
      };
      const seedRegistry = compRegistryForDeal(id, {
        state: subject.state ?? null,
        county: subject.county ?? null,
        zip: subject.zip ?? null,
        acres: subject.assessedAcres ?? null,
      }, reportLanes);
      const practicalSources = practicalOfficialParcelSources({
        county: subject.county,
        state: subject.state,
      });
      const sourceUrl = (source: string): string | null =>
        practicalSources.find((candidate) =>
          source.toLowerCase().includes(candidate.source.toLowerCase())
          || candidate.source.toLowerCase().includes(source.toLowerCase()))?.url ?? null;
      const practicalAttempts: Parameters<typeof makePracticalSubjectAttemptAdapters>[0] = [
        ...lookup.attempted.map((attempt) => ({
          source: attempt.source,
          url: sourceUrl(attempt.source),
          status: attempt.status === 'no_match' ? 'no_match' as const : 'unavailable' as const,
          note: attempt.note,
        })),
      ];
      const retainedBrowser = retainedBrowserGovernment(inspection, { county: subject.county, state: subject.state });
      practicalAttempts.push(...retainedBrowser.attempts);
      const soilOverlay = inspection?.overlays.find((overlay) => /soil/i.test(overlay.overlay)) ?? null;
      // ONE LANE'S MISSING PREREQUISITE MUST NOT DISABLE THE OTHERS.
      //
      // The whole live adapter set used to be constructed only in the branch
      // below, where an OfficialParcel exists. A parcel miss therefore silenced
      // every lane that had never needed a parcel — zoning/land use, the
      // marketplace lane and the Land Portal lane all fell through to the
      // orchestrator's no-adapter path and reported "not connected", which
      // reads as "LandOS was never wired up for this".
      //
      // Each lane is now assembled from the minimum canonical input it really
      // consumes: the location for zoning/planning/subdivision, nothing at all
      // for the parcel-independent lanes, and the parcel polygon only for the
      // lanes that read one.
      const parcelIndependentAdapters = [
        ...makePracticalSubjectAttemptAdapters(practicalAttempts, retainedBrowser.facts),
        ...makePracticalDiscoveryScreeningAdapters({
          county: subject.county,
          state: subject.state,
          coordinates: subject.coordinates,
          parcelSourceUrl: inspection?.parcelUrl,
          soilOverlay: soilOverlay ? {
            status: soilOverlay.status,
            note: soilOverlay.note,
            sourceUrl: inspection?.parcelUrl,
          } : null,
        }),
        // Zoning, planning and subdivision run from the resolved location and
        // the governing-authority workflow, never from parcel GIS. This is the
        // existing nationwide Land Use engine's accepted determination, not a
        // second engine.
        makeZoningLandUseAdapter({ dealCardId: id, mailingCity: str(property.city) }),
        ...makeParcelIndependentIntelligenceAdapters(),
      ];
      const covered = new Set(parcelIndependentAdapters.map((adapter) => adapter.task));
      const orchestratorRun = await runPropertyIntelligenceOrchestrator({
        subject,
        // The structured official lookup and the authenticated county-browser
        // pass already ran immediately above. Carry those real source attempts
        // into the canonical task graph instead of erasing them with an empty
        // adapter list merely because neither returned official geometry.
        adapters: [
          ...parcelIndependentAdapters,
          // The lanes that genuinely read the parcel polygon report their OWN
          // blocker here, naming the input they are missing, so no other lane
          // is described by it.
          ...makeOfficialParcelBlockedAdapters(
            PUBLIC_INTELLIGENCE_TASKS.filter((task) => !covered.has(task)),
            {
              requestedApn,
              county: subject.county,
              state: subject.state,
              attempted: lookup.attempted,
            },
          ),
        ],
        compJobs: [],
        retainedCompRuns: retainedCompRunsFromReport(reportLanes),
        captureMode: 'live',
        defaultTimeoutMs: 30_000,
        maxTimeoutMs: 60_000,
        subjectMarket: { state: subject.state, county: subject.county, zip: subject.zip, acres: subject.assessedAcres },
        seedRegistry,
      });
      const run = orchestratorRun.propertyIntelligence;
      if (!run) return { ok: false, error: 'Property intelligence orchestrator returned no blocked run', attempted: lookup.attempted };
      const unresolvedKey = `unresolved:${normalizeParcelIdentifier(requestedApn) || `deal-${id}`}`;
      const saved = new PublicIntelligenceStore().save(id, unresolvedKey, run, orchestratorRun);
      try {
        synchronizePropertySummaryForDeal({
          dealCardId: id,
          actor: 'public-property-intelligence',
          changeReason: discovery.discoveryUsable
            ? 'Recorded a conditional discovery-stage Property Summary after exact LandPortal subject reconciliation; official coverage remains disclosed.'
            : 'Recorded a blocked Property Summary because parcel identity remains unresolved.',
        });
      } catch (error) {
        logger.warn({ err: error, dealCardId: id }, 'property_summary_blocked_sync_failed');
      }
      const cardId = subjectCardId(deal);
      if (cardId) {
        try {
          attachCardActivity({
            cardId,
            agentId: 'public-property-intelligence',
            kind: discovery.discoveryUsable ? 'public_screening' : 'public_screening_blocked',
            summary: discovery.discoveryUsable
              ? 'Property Intelligence ran independent discovery-stage lanes against the exact LandPortal-correlated subject. Official parcel coverage remains a disclosed limitation.'
              : 'Property Intelligence retained provider outcomes, but the subject parcel remains unresolved.',
            ref: JSON.stringify({ status: orchestratorRun.status, contractVersion: orchestratorRun.contractVersion }),
          });
        } catch { /* the blocked orchestration remains authoritative */ }
      }
      return {
        ok: true,
        saved,
        parcel: {
          address: rawInput || null,
          county: lookupCounty ?? null,
          state: str(property.state) ?? null,
          apn: requestedApn ?? null,
          acres: subject.assessedAcres ?? null,
          sourceUrl: null,
        },
      };
    }
    const parcel = lookup.parcel;
    const subject = publicSubjectFromOfficialParcel(parcel, rawInput);
    const cardInspection = subjectCardId(deal);
    const retainedBrowser = retainedBrowserGovernment(
      cardInspection ? loadPropertyInspection(cardInspection) : null,
      { county: subject.county, state: subject.state },
    );
    const adapters = [
      ...makeLivePublicIntelligenceAdapters(parcel),
      // SAME source selection as the parcel-miss branch above. The accepted
      // Land Use determination is the primary legal and jurisdictional source
      // on both paths; the county GIS zoning polygon rides behind it as
      // supplemental spatial evidence because a parcel exists here to query it.
      makeZoningLandUseAdapter({
        dealCardId: id,
        mailingCity: str(property.city),
        gisSupplement: makeCountyGisZoningSupplement(parcel),
      }),
      ...makePracticalSubjectAttemptAdapters(retainedBrowser.attempts, retainedBrowser.facts),
    ];
    const seedRegistry = compRegistryForDeal(id, {
      state: subject.state ?? null,
      county: subject.county ?? null,
      zip: subject.zip ?? null,
      acres: subject.assessedAcres ?? null,
    }, reportLanes);
    const orchestratorRun = await runPropertyIntelligenceOrchestrator({
      subject,
      adapters,
      compJobs: [],
      retainedCompRuns: retainedCompRunsFromReport(reportLanes),
      captureMode: 'live',
      defaultTimeoutMs: 30_000,
      maxTimeoutMs: 60_000,
      subjectMarket: { state: subject.state, county: subject.county, zip: subject.zip, acres: subject.assessedAcres },
      seedRegistry,
    });
    const run = orchestratorRun.propertyIntelligence;
    if (!run) {
      return { ok: false, error: 'Property intelligence orchestrator returned no run', attempted: null };
    }
    const saved = new PublicIntelligenceStore().save(id, parcel.apn, run, orchestratorRun);
    const cardId = subjectCardId(deal);
    if (cardId) {
      try {
        // The official public parcel lane is a first-class identity provider.
        // Persist its exact APN + jurisdiction onto the existing subject card so
        // every Deal Card surface (and the report runner) sees the same verified
        // identity immediately after the operator's public-screening action.
        upsertPropertyCard({
          entity: deal.entity as LandosEntity,
          cardId,
          activeInputAddress: rawInput || parcel.address,
          county: parcel.county,
          state: parcel.state,
          apn: parcel.apn,
          owner: parcel.owner ?? undefined,
          acres: parcel.acres ?? undefined,
          lat: parcel.coordinates.lat,
          lng: parcel.coordinates.lng,
          verified: true,
          verificationSource: parcel.provider,
          agentId: 'public-property-intelligence',
        });
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
      synchronizePropertySummaryForDeal({
        dealCardId: id,
        actor: 'public-property-intelligence',
        changeReason: 'Updated the Property Summary after a persisted official assessor/GIS collection.',
      });
    } catch (error) {
      logger.warn({ err: error, dealCardId: id }, 'property_summary_public_sync_failed');
    }
    try {
      attachCardActivity({
        cardId: Number(property.id), agentId: 'public-property-intelligence', kind: 'public_screening',
        summary: `Public property screening completed: ${run.tasks.filter((task) => task.status === 'succeeded').length}/${run.tasks.length} provider tasks succeeded.`,
        ref: JSON.stringify({ status: run.status, parcelKey: parcel.apn, contractVersion: orchestratorRun.contractVersion, orchestratorStatus: orchestratorRun.status }),
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

  // ══ Property Intelligence: ONE operator action, ONE parent mission ═════════
  // The operator clicks Run Property Intelligence on the Deal Card. This starts
  // the parent mission, returns immediately with the run id, and the specialists
  // continue in the background so progress is visible while it works. The joined
  // snapshot is written back to THIS Deal Card and becomes the primary read.
  const propertyIntelligenceStore = new PropertyIntelligenceStore();
  const propertyResearchStore = new PropertyResearchStore();

  /** One cross-page decision state, assembled from the current accepted comp
   * workspace and the promoted Property Intelligence snapshot. Routes project
   * this object verbatim; none of them recomputes counts or conclusions. */
  const canonicalDealStateFor = (
    dealCardId: number,
    snapshotOverride?: ReturnType<typeof presentPropertyIntelligenceSnapshot> | null,
  ): CanonicalDealState | null => {
    const snapshot = snapshotOverride
      ?? (() => {
        const stored = propertyIntelligenceStore.primaryRun(dealCardId)?.snapshot ?? null;
        return stored ? presentPropertyIntelligenceSnapshot(stored) : null;
      })();
    const compsView = buildCompsValuationView(dealCardId);
    if (!snapshot || !compsView) return null;
    const toSnapshotComp = (comp: (typeof compsView.comps)[number], lane: 'sold' | 'active') => ({
      key: comp.key,
      apn: comp.apn,
      address: comp.address,
      lane,
      source: comp.source,
      providerAttributions: comp.origins,
      sourceUrl: comp.sourceUrl,
      status: comp.saleVerification === 'source_stated' ? 'source_stated' : comp.statusLabel,
      dateIso: comp.dateIso,
      price: comp.price,
      acres: comp.acres,
      pricePerAcre: comp.pricePerAcre,
      distanceMiles: comp.distanceMiles,
      daysOnMarket: comp.daysOnMarket,
      thumbnailUrl: comp.thumbnailUrl,
      photoUrls: comp.photoUrls ?? [],
      whyUseful: comp.classificationReason,
      similarities: comp.primaryComparability ? [comp.primaryComparability] : [],
      differences: comp.keyDifference ? [comp.keyDifference] : [],
    });
    const sold = compsView.comps.filter((comp) => comp.inValuationSet).map((comp) => toSnapshotComp(comp, 'sold'));
    const active = compsView.comps.filter((comp) => comp.category === 'active_competition').map((comp) => toSnapshotComp(comp, 'active'));
    const askingReferences = compsView.comps.filter((comp) => comp.category === 'asking_reference').map((comp) => toSnapshotComp(comp, 'active'));
    const acquisition = getAcquisition(dealCardId);
    const research = researchStatusFrom(snapshot.specialists, snapshot.dueDiligence);
    return buildCanonicalDealState({
      comps: {
        sold,
        active,
        askingReferences,
        totalCollected: compsView.canonicalCompCount,
        duplicatesMerged: compsView.duplicatesMerged,
      },
      valuation: {
        ...snapshot.valuation,
        priceable: compsView.summary.fmv != null,
        notPriceableReason: compsView.summary.fmv == null
          ? compsView.summary.acquisitionLockedReason ?? snapshot.valuation.notPriceableReason
          : null,
        materialGaps: compsView.explanation.neededEvidence,
      },
      subject: {
        improved: compsView.subjectImprovement.improved,
        improvementBasis: compsView.subjectImprovement.evidence,
        improvementsValued: !compsView.subjectImprovement.wholePropertyPending,
      },
      ownerSeller: {
        ownerOfRecord: snapshot.identity.owner,
        ownerSource: snapshot.identity.explanation,
        ownerVerified: snapshot.identity.state === 'confirmed',
        sellerName: acquisition.profile.name ?? null,
        sellerIntakeCollected: !!acquisition.profile.name?.trim(),
      },
      research,
      rawBlockers: snapshot.blockers,
      rawMissingInformation: snapshot.missingInformation,
      extraNextActions: [snapshot.valuation.nextActionToPrice],
    });
  };
  // Leave bounded headroom inside the 300-second parcel-identity mission for
  // the subsequent official parcel lookup and public-intelligence task graph.
  // runPropertyInspection shares this budget across LandPortal + county work.
  const SUBJECT_INSPECTION_TIMEOUT_MS = 120_000;

  // ── New Lead reaches LandPortal through the shared Capability ─────────────
  //
  // The browser factories, the authenticated LandPortal session and the Hermes
  // launcher stay exactly where they are; what changed is WHO invokes them.
  // Both New Lead LandPortal lanes now execute INSIDE the LandPortal Research
  // Capability, so Tools, New Lead and the Deal Card share one implementation,
  // one subject contract and one invocation record, and no caller keeps its own
  // authoritative LandPortal execution path.
  const landPortalResearchEntity = (dealCardId: number): LandosEntity =>
    (getDealCard(dealCardId)?.entity as LandosEntity | undefined) ?? 'TY_LAND_BIZ';

  const throughLandPortalParcelInspection = async (
    dealCardId: number,
    caller: 'new_lead' | 'deal_card' | 'internal_workflow',
    cardId: number,
    execute: () => Promise<LandPortalInspectionOutcome>,
  ): Promise<LandPortalInspectionOutcome> => {
    let executed: LandPortalInspectionOutcome | null = null;
    try {
      const result = await invokeRuntimeCapability({
        capabilityId: LANDPORTAL_RESEARCH_CAPABILITY_ID,
        caller: { type: caller, ref: `deal:${dealCardId}` },
        subject: { kind: 'canonical_property', entity: landPortalResearchEntity(dealCardId), propertyCardId: cardId, dealCardId },
        mode: 'refresh',
        parameters: { lane: 'parcel_inspection' },
        context: { surface: 'new_lead', dealCardId },
      }, { runParcelInspection: async () => { executed = await execute(); return executed; } });
      if (executed) return executed;
      return {
        ok: false,
        comparableCount: 0,
        note: result.warnings[0] ?? 'The LandPortal Research Capability did not release the authenticated parcel read for this subject.',
      };
    } catch (error) {
      // An invocation that never ran reports why; it never falls back to a
      // second LandPortal path outside the capability.
      return { ok: false, comparableCount: 0, note: error instanceof Error ? error.message : String(error) };
    }
  };

  const throughLandPortalAgenticSpecialists = async (
    dealCardId: number,
    caller: 'new_lead' | 'deal_card' | 'internal_workflow',
    input: Parameters<typeof runHermesLandPortalLane>[0],
  ): Promise<HermesLandPortalLaneOutcome> => {
    let executed: HermesLandPortalLaneOutcome | null = null;
    const refused = (note: string): HermesLandPortalLaneOutcome => {
      const stamp = new Date().toISOString();
      return {
        status: 'failed', runId: input.runId, dealCardId: input.dealCardId, propertyCardId: input.propertyCardId,
        propertyLabel: hermesLandPortalPropertyLabel(input), outputFile: '',
        startedAt: stamp, completedAt: stamp, runtimeMs: 0, note,
        importResult: null, importResults: [], persistedCategories: [], workUnits: [],
      };
    };
    try {
      const result = await invokeRuntimeCapability({
        capabilityId: LANDPORTAL_RESEARCH_CAPABILITY_ID,
        caller: { type: caller, ref: `deal:${dealCardId}` },
        subject: { kind: 'canonical_property', entity: landPortalResearchEntity(dealCardId), propertyCardId: input.propertyCardId, dealCardId },
        mode: 'refresh',
        parameters: { lane: 'agentic_specialists', runId: input.runId },
        context: { surface: 'new_lead', dealCardId },
      }, {
        runAgenticSpecialists: async (): Promise<LandPortalAgenticOutcome> => {
          executed = await runHermesLandPortalLane(input);
          return {
            status: executed.status,
            runId: executed.runId,
            note: executed.note,
            persistedCategories: executed.persistedCategories.map((category) => category.category),
            workUnits: executed.workUnits.map((unit) => ({ specialist: unit.specialist, status: unit.status, note: unit.note })),
          };
        },
      });
      return executed ?? refused(result.warnings[0] ?? 'The LandPortal Research Capability did not release the specialist lane for this subject.');
    } catch (error) {
      return refused(error instanceof Error ? error.message : String(error));
    }
  };

  // ── New Lead reaches comping and valuation through the shared Capability ──
  //
  // The marketplace transports, the provider browsers and the mission's own
  // valuation computation stay exactly where they are; what changed is WHO
  // invokes them. New Lead's comparable-collection lane and its valuation lane
  // both execute INSIDE the Comps & Valuation Capability, so Tools, New Lead and
  // the Deal Card share one implementation, one subject contract and one
  // invocation record, and no caller keeps its own authoritative comp or
  // valuation execution path.
  const compsValuationEntity = (dealCardId: number): LandosEntity =>
    (getDealCard(dealCardId)?.entity as LandosEntity | undefined) ?? 'TY_LAND_BIZ';

  /**
   * The existing comparable-collection lane, run inside the capability.
   *
   * The collection itself is unchanged — the same providers, the same parallel
   * mission, the same persistence. When the capability declines to release the
   * lane, the collector reports that instead of running a second path outside
   * it, and the mission's own honest "no candidates" handling takes over.
   */
  const throughCompCollection = async (
    dealCardId: number,
    caller: 'new_lead' | 'deal_card' | 'internal_workflow',
    execute: () => Promise<SpecialistOutcome<ComparablesContribution>>,
  ): Promise<SpecialistOutcome<ComparablesContribution>> => {
    const cardId = subjectCardId(getDealCard(dealCardId) ?? {});
    if (!cardId) return execute();
    let executed: SpecialistOutcome<ComparablesContribution> | null = null;
    try {
      const result = await invokeRuntimeCapability({
        capabilityId: COMPS_VALUATION_CAPABILITY_ID,
        caller: { type: caller, ref: `deal:${dealCardId}` },
        subject: { kind: 'canonical_property', entity: compsValuationEntity(dealCardId), propertyCardId: cardId, dealCardId },
        mode: 'refresh',
        parameters: { lane: 'comp_collection' },
        context: { surface: 'new_lead', dealCardId },
      }, {
        runCompCollection: async (): Promise<CompCollectionOutcome> => {
          executed = await execute();
          const candidates = executed.data?.candidates ?? [];
          const market = marketContextFor(getDealCard(dealCardId));
          const policy = applyCompSourcePolicy({
            state: market.geography.state,
            county: market.geography.county ?? market.geography.fips,
            zip: market.geography.zip,
            acres: market.geography.acres,
          }, candidates);
          return {
            candidateCount: candidates.length,
            usableCandidateCount: policy.acceptedSold.length + policy.acceptedActive.length,
            duplicatesMerged: executed.data?.duplicatesMerged ?? 0,
            sources: [...new Set(candidates.map((candidate) => candidate.provider).filter(Boolean))],
            summary: executed.summary,
            sourceAttempts: [{
              source: 'Comparable collection lane',
              status: executed.status,
              note: executed.summary,
            }],
          };
        },
      });
      if (executed) return executed;
      return {
        status: 'blocked',
        summary: result.warnings[0] ?? 'The Comps & Valuation Capability did not release the comparable-collection lane for this subject.',
        data: null,
      };
    } catch (error) {
      return {
        status: 'blocked',
        summary: error instanceof Error ? error.message : String(error),
        data: null,
      };
    }
  };

  /**
   * New Lead's valuation computation, run inside the capability.
   *
   * `computeMissionCompValuation` IS the mission's existing implementation; the
   * capability executes it rather than deriving a value of its own, so the
   * valuation on a new lead and the valuation the capability reports can never
   * be two different calculations.
   */
  const throughMissionValuation = async (
    dealCardId: number,
    caller: 'new_lead' | 'deal_card' | 'internal_workflow',
    input: MissionCompValuationInput,
  ): Promise<MissionCompValuationResult> => {
    const cardId = subjectCardId(getDealCard(dealCardId) ?? {});
    if (!cardId) return computeMissionCompValuation(input);
    let executed: MissionCompValuationResult | null = null;
    try {
      await invokeRuntimeCapability({
        capabilityId: COMPS_VALUATION_CAPABILITY_ID,
        caller: { type: caller, ref: `deal:${dealCardId}` },
        subject: { kind: 'canonical_property', entity: compsValuationEntity(dealCardId), propertyCardId: cardId, dealCardId },
        mode: 'refresh',
        parameters: { lane: 'mission_valuation' },
        context: { surface: 'new_lead', dealCardId },
      }, {
        runMissionValuation: async (): Promise<MissionValuationOutcome> => {
          executed = computeMissionCompValuation(input);
          return {
            priceable: executed.valuation.priceable,
            rangeLow: executed.valuation.range?.low ?? null,
            rangeHigh: executed.valuation.range?.high ?? null,
            confidence: executed.valuation.confidence ?? null,
            notPriceableReason: executed.valuation.notPriceableReason ?? null,
            acceptedSoldCount: executed.acceptedSoldCount,
            activeListingCount: executed.activeListingCount,
            landHomeCompCount: executed.landHomeCompCount,
            summary: executed.valuation.priceable
              ? `Value band from ${executed.acceptedSoldCount} selected closed sale(s) and ${executed.activeListingCount} selected active competitor(s).`
              : `Not priceable: ${executed.valuation.notPriceableReason}`,
          };
        },
      });
      // The valuation is a pure computation over evidence the mission already
      // holds. An invocation-envelope failure must never delete a valuation the
      // operator's comps support, so the same shared computation still answers.
      return executed ?? computeMissionCompValuation(input);
    } catch {
      return computeMissionCompValuation(input);
    }
  };

  // ── New Lead reaches land use and property history through the Capabilities ─
  //
  // The three post-resolution lanes are the same accepted implementation, run
  // by the same keyless transports. What changed is WHO invokes them: the
  // authority + current-zoning lane and the subdivision lane execute inside the
  // Zoning & Subdivision Capability, and the backstory lane executes inside the
  // Property Development History Capability. That is what keeps New Lead, Tools
  // and the Deal Card on one implementation each, and it is why neither
  // capability can be bypassed by a caller keeping its own path.
  //
  // Each wrapper degrades to the underlying lane when the capability envelope
  // itself fails. An invocation-record problem must never delete research the
  // operator's lead depends on.
  const throughLandUseCapabilities = (
    dealCardId: number,
    caller: 'new_lead' | 'deal_card' | 'internal_workflow',
    live: ReturnType<typeof livePostResolutionCapabilities>,
  ): ReturnType<typeof livePostResolutionCapabilities> => {
    const canonicalSubject = () => {
      const cardId = subjectCardId(getDealCard(dealCardId) ?? {});
      return cardId
        ? {
            kind: 'canonical_property' as const,
            entity: compsValuationEntity(dealCardId),
            propertyCardId: cardId,
            dealCardId,
          }
        : null;
    };

    /** Run one land-use lane inside the Zoning & Subdivision Capability. */
    const throughZoningSubdivision = async <T>(
      runId: string,
      execute: () => Promise<T>,
      describe: (result: T) => string,
    ): Promise<T> => {
      const subject = canonicalSubject();
      if (!subject) return execute();
      let executed: { value: T } | null = null;
      try {
        await invokeRuntimeCapability({
          capabilityId: ZONING_SUBDIVISION_CAPABILITY_ID,
          caller: { type: caller, ref: `deal:${dealCardId}` },
          subject,
          mode: 'refresh',
          parameters: { lane: 'research', runId },
          context: { surface: 'new_lead', dealCardId },
        }, {
          runLandUseResearch: async (): Promise<LandUseResearchOutcome> => {
            executed = { value: await execute() };
            return { ran: true, lanes: [{ lane: runId, status: 'success', durationMs: 0 }], summary: describe(executed.value) };
          },
        });
      } catch {
        // fall through to the underlying lane below
      }
      return executed ? (executed as { value: T }).value : execute();
    };

    return {
      ...live,
      propertyBackstory: async (input) => {
        const subject = canonicalSubject();
        if (!subject) return live.propertyBackstory(input);
        let executed: PropertyBackstory | null = null;
        try {
          await invokeRuntimeCapability({
            capabilityId: PROPERTY_DEVELOPMENT_HISTORY_CAPABILITY_ID,
            caller: { type: caller, ref: `deal:${dealCardId}` },
            subject,
            mode: 'refresh',
            parameters: { lane: 'research' },
            context: { surface: 'new_lead', dealCardId },
          }, {
            runHistorySearch: async (): Promise<PropertyBackstory> => {
              executed = await live.propertyBackstory(input);
              return executed;
            },
          });
        } catch {
          // fall through to the underlying lane below
        }
        return executed ?? live.propertyBackstory(input);
      },
      landUseAuthorityAndZoning: (input) => throughZoningSubdivision(
        'authority_and_zoning',
        () => live.landUseAuthorityAndZoning(input),
        (result) => `Controlling authority ${result.authority.zoningAuthority.determination}; current zoning ${result.zoning.established ? result.zoning.districtCode ?? 'established' : 'not established'}.`,
      ),
      subdivisionIntelligence: (input) => throughZoningSubdivision(
        'subdivision_rules',
        () => live.subdivisionIntelligence(input),
        (result) => `${result.regulations.rules.length} subdivision rule(s) from ${result.regulations.documents.length} official document(s); likely path ${result.propertyRead.likelyPath.kind}.`,
      ),
    };
  };

  const propertyIntelligenceCollectors = (
    dealCardId: number,
    resolutionCaller: 'new_lead' | 'deal_card' | 'internal_workflow' = 'internal_workflow',
    resolutionMode: 'reuse' | 'refresh' = 'reuse',
  ): PropertyIntelligenceCollectors => {
    const live = makeLivePropertyIntelligenceCollectors({
    resolutionCaller,
    resolutionMode,
    persistProviderResult: (result) => propertyResearchStore.persistProviderResult(result),
    captureHermesLandPortal: (input) => throughLandPortalAgenticSpecialists(dealCardId, resolutionCaller, input),
    runPublicIntelligence: async (id) => {
      const deal = getDealCard(id);
      const property = deal ? resolveSubjectPropertyCard(deal).card ?? {} : {};
      const lookup = await lookupOfficialParcel({
        address: str(property.active_input_address) ?? str(property.address),
        county: str(property.county),
        state: str(property.state),
        apn: str(property.apn),
        owner: str(property.owner),
      }, 25_000);
      if (!lookup.parcel) return { ok: false, error: lookup.status };
      return {
        ok: true,
        patch: officialParcelPatch(lookup.parcel),
        source: { label: lookup.parcel.provider, url: lookup.parcel.sourceUrl },
      };
    },
    runPublicIntelligenceAfterResolution: async (id) => {
      const result = await runPublicIntelligenceForDealCard(id);
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    },
    captureExactAddressWeb: async (input) => {
      const queries = buildExactAddressQueries(input);
      // Exact-address discovery is a browser research lane end to end.
      //
      // The previous transport extracted result links from a plain server-side
      // fetch of Google and Bing, and read candidate listing pages the same
      // way. Both refuse a bare fetch, so the lane reported "no property-specific
      // page could be retained" for an address whose Zillow and MLS pages are
      // indexed and public. Nothing here uses node fetch any more: the driver
      // reads real result anchors from the static search endpoint inside the
      // dedicated LandOS browser, and the background-browser transport reads the
      // listing pages themselves in that same browser.
      const browserReady = await ensureBrowserSessionReady();
      const discoveryBrowser = makeLiveBrowserDriver(`exact-address-web-${dealCardId}`);
      const browserFetchText = createBackgroundBrowserFetchText();
      const CHALLENGE = /captcha|unusual traffic|verify you are human/i;
      const SEARCH_TIMEOUT_MS = 20_000;
      const PAGE_TIMEOUT_MS = 25_000;
      /** Property-specific result URLs, each remembered with the query that found it. */
      const discovered = new Map<string, string>();
      let successfulSearches = 0;
      let blockedSearches = 0;

      const keepPropertySpecific = (links: Array<{ text: string; href: string }>, query: string): void => {
        for (const link of unwrapSearchResults(links)) {
          if (!classifyDiscoveryResult(link.href).propertySpecific) continue;
          if (!discovered.has(link.href)) discovered.set(link.href, query);
        }
      };

      const run = async (): Promise<ExactAddressWebResult> => {
        for (const query of queries) {
          let answered = false;
          // 1. Read the result anchors through the driver, the same path the
          //    county-records discovery lane already uses successfully.
          if (browserReady.status === 'live' && discoveryBrowser.configured() && discoveryBrowser.readLinks) {
            try {
              const read = await discoveryBrowser.open(searchEngineUrl(query), { timeoutMs: SEARCH_TIMEOUT_MS });
              if (CHALLENGE.test(read.snippets.join(' '))) {
                blockedSearches += 1;
              } else {
                const links = await discoveryBrowser.readLinks({ timeoutMs: SEARCH_TIMEOUT_MS });
                if (links.length) {
                  successfulSearches += 1;
                  answered = true;
                  keepPropertySpecific(links, query);
                }
              }
            } catch { /* the engine fallback below continues this same query */ }
          }
          // 2. Engine fallback, still inside the browser. A challenge page is
          //    counted as blocked rather than silently dropped.
          for (const engine of [
            searchEngineUrl(query),
            `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
          ]) {
            if (answered) break;
            try {
              const page = await browserFetchText(engine, { timeoutMs: SEARCH_TIMEOUT_MS });
              if (page.blocked || !page.body || CHALLENGE.test(page.body)) { blockedSearches += 1; continue; }
              const links = extractLinks(page.body, page.url).map((link) => ({ text: link.label, href: link.url }));
              if (!links.length) continue;
              successfulSearches += 1;
              answered = true;
              keepPropertySpecific(links, query);
            } catch { /* the next engine is the required fallback */ }
          }
        }

        const pages: ExtractedListingEvidence[] = [];
        const addressKey = input.address.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        const streetKey = addressKey.split(',')[0]?.trim() ?? addressKey;
        for (const url of [...discovered.keys()].slice(0, 12)) {
          try {
            const page = await browserFetchText(url, { timeoutMs: PAGE_TIMEOUT_MS });
            if (page.blocked || !page.body || page.status >= 400) continue;
            const textContent = htmlBodyToText(page.body);
            // The page must name this exact street and ZIP before it is retained
            // as this subject's evidence. Identity gating is unchanged.
            const pageIdentity = `${url} ${textContent}`.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
            if (!streetKey || !pageIdentity.includes(streetKey)) continue;
            if (input.zip && !pageIdentity.includes(input.zip.replace(/[^0-9]/g, ''))) continue;
            pages.push(extractListingEvidence({ url, text: textContent, retrievedAt: new Date().toISOString() }));
          } catch { /* retain the successful search proof and continue */ }
        }

        const status = pages.length ? 'retrieved' as const
          : successfulSearches ? 'none' as const
            : blockedSearches ? 'blocked' as const : 'error' as const;
        return {
          status,
          queries,
          pages,
          note: pages.length
            ? `${pages.length} property-specific result page(s) were read from exact-address search discovery through the dedicated LandOS browser.`
            : successfulSearches
              ? `The exact-address searches ran and returned results, but none of the ${discovered.size} property-specific candidate page(s) could be read and matched to this exact address and ZIP.`
              : blockedSearches
                ? 'Search engines blocked the exact-address discovery attempts after the alternate-engine fallback.'
                : 'Exact-address search attempts failed before a result page could be read.',
        };
      };

      return withOwnedPages(discoveryBrowser, run);
    },
    captureZillowComps: async (input) => {
      const market = publicLocalityFallback(dealCardId, {
        address: input.address ?? undefined,
        city: input.city ?? undefined,
        county: input.county ?? undefined,
        state: input.state ?? undefined,
        zip: input.zip ?? undefined,
        apn: input.apn ?? undefined,
        owner: input.owner ?? undefined,
        lat: input.lat ?? undefined,
        lng: input.lng ?? undefined,
      });
      // The public active board and recently-sold board are distinct Zillow
      // surfaces. Read both explicitly; never relabel an active/unknown row as
      // sold merely because it came from a sold-search URL.
      // Sold window matches the operator's own search: last 12 months.
      const soldResult = await fetchZillowLandComps({
        ...market,
        subjectAcres: input.subjectAcres,
        mode: 'sold',
        dateWindowMonths: 12,
      });
      const activeResult = await fetchZillowLandComps({
        ...market,
        subjectAcres: input.subjectAcres,
        mode: 'active',
      });
      const resultStatus = soldResult.status === 'retrieved' || activeResult.status === 'retrieved'
        ? 'retrieved'
        : soldResult.status === 'blocked' || activeResult.status === 'blocked'
          ? 'blocked'
          : soldResult.status === 'error' || activeResult.status === 'error'
            ? 'error'
            : soldResult.status === 'disabled' && activeResult.status === 'disabled'
              ? 'disabled'
              : 'none';
      const project = (comp: (typeof soldResult.comps)[number], lane: 'sold' | 'active') => ({
        address: comp.address, price: comp.price, acres: comp.acres, pricePerAcre: comp.pricePerAcre,
        url: comp.url, status: comp.status,
        saleDate: lane === 'sold' ? comp.soldDate ?? null : comp.listingDate ?? null,
        listingDate: comp.listingDate ?? null, daysOnMarket: comp.daysOnMarket ?? null,
        thumbnailUrl: comp.thumbnailUrl ?? null,
        lat: comp.lat ?? null, lng: comp.lng ?? null,
        homeType: comp.homeType ?? null, yearBuilt: comp.yearBuilt ?? null, homeSizeSqft: comp.homeSizeSqft ?? null,
        collectedAt: new Date().toISOString(),
      });
      return {
        status: resultStatus,
        note: `Sold board: ${soldResult.note} Active board: ${activeResult.note}`,
        laneRoutes: [...soldResult.routes, ...activeResult.routes],
        searchVerified: soldResult.searchVerified || activeResult.searchVerified,
        retrievalCounts: {
          visible: soldResult.retrievalCounts.visible + activeResult.retrievalCounts.visible,
          extracted: soldResult.retrievalCounts.extracted + activeResult.retrievalCounts.extracted,
          normalized: soldResult.retrievalCounts.normalized + activeResult.retrievalCounts.normalized,
        },
        sold: soldResult.comps.filter((comp) => comp.status === 'sold').map((comp) => project(comp, 'sold')),
        active: activeResult.comps.filter((comp) => comp.status === 'active').map((comp) => project(comp, 'active')),
      };
    },
    captureManufacturedHomeComps: async (input) => {
      const result = await fetchZillowLandComps({
        ...publicLocalityFallback(dealCardId, {
          address: input.address ?? undefined,
          city: input.city ?? undefined,
          county: input.county ?? undefined,
          state: input.state ?? undefined,
          zip: input.zip ?? undefined,
          apn: input.apn ?? undefined,
          owner: input.owner ?? undefined,
          lat: input.lat,
          lng: input.lng,
        }),
        lat: input.lat,
        lng: input.lng,
        propertyType: 'manufactured',
        mode: 'sold',
        radiusMiles: 5,
        dateWindowMonths: 24,
      });
      return {
        status: result.status,
        note: result.note,
        searchProof: result.searchProof,
        active: [],
        sold: result.comps.map((comp) => ({
          address: comp.address,
          price: comp.price,
          acres: comp.acres,
          pricePerAcre: comp.pricePerAcre,
          url: comp.url,
          status: comp.status,
          saleDate: comp.soldDate ?? null,
          collectedAt: new Date().toISOString(),
          lat: comp.lat ?? null,
          lng: comp.lng ?? null,
          distanceMiles: comp.lat != null && comp.lng != null
            ? distanceMiles({ lat: input.lat, lng: input.lng }, { lat: comp.lat, lng: comp.lng })
            : null,
          homeType: comp.homeType ?? null,
          yearBuilt: comp.yearBuilt ?? null,
          homeSizeSqft: comp.homeSizeSqft ?? null,
        })),
      };
    },
    captureRedfinComps: async (input) => {
      const market = publicLocalityFallback(dealCardId, {
        address: input.address ?? undefined,
        city: input.city ?? undefined,
        county: input.county ?? undefined,
        state: input.state ?? undefined,
        zip: input.zip ?? undefined,
        apn: input.apn ?? undefined,
        owner: input.owner ?? undefined,
        lat: input.lat ?? undefined,
        lng: input.lng ?? undefined,
      });
      // Sold window matches the operator's own search: last 12 months.
      const soldResult = await fetchRedfinLandComps({
        ...market,
        subjectAcres: input.subjectAcres,
        mode: 'sold',
        dateWindowMonths: 12,
      });
      const activeResult = await fetchRedfinLandComps({
        ...market,
        subjectAcres: input.subjectAcres,
        mode: 'active',
      });
      const resultStatus = soldResult.status === 'retrieved' || activeResult.status === 'retrieved'
        ? 'retrieved'
        : soldResult.status === 'blocked' || activeResult.status === 'blocked'
          ? 'blocked'
          : soldResult.status === 'error' || activeResult.status === 'error'
            ? 'error'
            : soldResult.status === 'disabled' && activeResult.status === 'disabled'
              ? 'disabled'
              : 'none';
      return {
        status: resultStatus,
        laneRoutes: [...soldResult.routes, ...activeResult.routes],
        searchVerified: soldResult.searchVerified || activeResult.searchVerified,
        retrievalCounts: {
          visible: soldResult.retrievalCounts.visible + activeResult.retrievalCounts.visible,
          extracted: soldResult.retrievalCounts.extracted + activeResult.retrievalCounts.extracted,
          normalized: soldResult.retrievalCounts.normalized + activeResult.retrievalCounts.normalized,
        },
        note: `Sold board: ${soldResult.note} Active board: ${activeResult.note}`,
        sold: soldResult.comps.filter((comp) => comp.status === 'sold').map((comp) => ({
          address: comp.address, price: comp.price, acres: comp.acres, pricePerAcre: comp.pricePerAcre,
          url: comp.url, status: comp.status, saleDate: comp.soldDate ?? null,
          listingDate: comp.listingDate ?? null, daysOnMarket: comp.daysOnMarket ?? null,
          thumbnailUrl: comp.thumbnailUrl ?? null,
          homeType: comp.homeType ?? null, homeSizeSqft: comp.homeSizeSqft ?? null,
          collectedAt: new Date().toISOString(),
        })),
        active: activeResult.comps.filter((comp) => comp.status === 'active').map((comp) => ({
          address: comp.address, price: comp.price, acres: comp.acres, pricePerAcre: comp.pricePerAcre,
          url: comp.url, status: comp.status, saleDate: comp.listingDate ?? null,
          listingDate: comp.listingDate ?? null, daysOnMarket: comp.daysOnMarket ?? null,
          thumbnailUrl: comp.thumbnailUrl ?? null,
          homeType: comp.homeType ?? null, homeSizeSqft: comp.homeSizeSqft ?? null,
          collectedAt: new Date().toISOString(),
        })),
      };
    },
    captureRealtorComps: async (input) => {
      const market = publicLocalityFallback(dealCardId, {
        address: input.address ?? undefined,
        city: input.city ?? undefined,
        county: input.county ?? undefined,
        state: input.state ?? undefined,
        zip: input.zip ?? undefined,
        apn: input.apn ?? undefined,
        owner: input.owner ?? undefined,
        lat: input.lat ?? undefined,
        lng: input.lng ?? undefined,
      });
      const [soldResult, activeResult] = await Promise.all([
        fetchRealtorLandComps({ ...market, subjectAcres: input.subjectAcres, mode: 'sold' }),
        fetchRealtorLandComps({ ...market, subjectAcres: input.subjectAcres, mode: 'active' }),
      ]);
      const resultStatus = soldResult.status === 'retrieved' || activeResult.status === 'retrieved'
        ? 'retrieved'
        : soldResult.status === 'blocked' || activeResult.status === 'blocked'
          ? 'blocked'
          : soldResult.status === 'error' || activeResult.status === 'error'
            ? 'error'
            : soldResult.status === 'disabled' && activeResult.status === 'disabled'
              ? 'disabled'
              : 'none';
      const project = (comp: (typeof soldResult.comps)[number]) => ({
        address: comp.address,
        price: comp.price,
        acres: comp.acres,
        pricePerAcre: comp.pricePerAcre,
        url: comp.url,
        status: comp.status,
        saleDate: comp.soldDate ?? comp.listingDate ?? null,
        listingDate: comp.listingDate ?? null,
        daysOnMarket: comp.daysOnMarket ?? null,
        homeType: comp.homeType ?? null,
        yearBuilt: comp.yearBuilt ?? null,
        homeSizeSqft: comp.homeSizeSqft ?? null,
        thumbnailUrl: comp.thumbnailUrl ?? null,
        photoUrls: comp.photoUrls ?? [],
        collectedAt: new Date().toISOString(),
      });
      return {
        status: resultStatus,
        laneRoutes: [...soldResult.routes, ...activeResult.routes],
        searchVerified: soldResult.searchVerified || activeResult.searchVerified,
        note: `Sold board: ${soldResult.note} Active board: ${activeResult.note}`,
        sold: soldResult.comps.filter((comp) => comp.status === 'sold').map(project),
        active: activeResult.comps.filter((comp) => comp.status === 'active').map(project),
      };
    },
    // PRIMARY comp lane. Reads the authenticated LandPortal parcel page through
    // the single-tab browser mission gate and persists the inspection with the
    // existing cumulative (non-destructive) merge, so retained evidence and
    // assets survive. Free visible rows only — no paid comp report is requested.
    //
    // The read itself is unchanged; it now runs INSIDE the LandPortal Research
    // Capability, which owns the canonical subject, the invocation record and
    // the result. The browser work stays here because the browser factories and
    // the LandPortal auth path do.
    captureLandPortalInspection: async ({ cardId, searchKey, onSubjectReady }) =>
      throughLandPortalParcelInspection(dealCardId, resolutionCaller, cardId, async () => {
      const readiness = await ensureLandPortalAuthenticated()
        .then((value) => ({ authenticated: value.authenticated, phase: String(value.phase), detail: value.note || value.reason || '' }))
        .catch((err) => ({ authenticated: false, phase: 'attach_failed', detail: (err as Error)?.message ?? String(err) }));
      if (!readiness.authenticated) {
        // Pre-run gate. This lane cannot read a parcel page without a live
        // dedicated browser, and returning ok:false quietly is what made a
        // dead CDP endpoint look like an ordinary empty result.
        logger.error({
          event: 'landportal_capture_pre_run_blocked',
          cardId,
          phase: readiness.phase,
          detail: readiness.detail,
        }, 'landportal_capture_pre_run_blocked');
        return {
          ok: false,
          comparableCount: 0,
          note: `LandPortal session is ${readiness.phase} (${readiness.detail || 'not authenticated'}). Check \`npm run landos:browser status\`, then Start Browser Intelligence so the parcel page can be read.`,
        };
      }
      // A subject that already carries a verified canonical parcel URL is not
      // searched for again: the workflow opens that record directly (it still
      // verifies it, and still falls back to searching without one).
      const retainedInspection = loadPropertyInspection(cardId);
      // Order matters: a parcel URL LandOS already retained and verified beats
      // the operator's link. Only when nothing usable is retained does the
      // operator's own supplied link become the entry point — it still gets
      // opened, verified, and falls back to searching if it is not the subject.
      //
      // "Usable" is the load-bearing word. A failed LandPortal run persists
      // whatever page it ended on as `parcelUrl`, and on Deal 90 that was the
      // bare site root. Treating that as a retained parcel URL both wasted a
      // navigation and — because it ranked above the operator's link — meant the
      // operator's own saved-map link was never opened at all.
      const retainedEntryUrl = operatorLandPortalEntryUrl(retainedInspection?.parcelUrl)
        ?? (retainedInspection?.parcelUrl && !/landportal\.com/i.test(retainedInspection.parcelUrl)
          ? retainedInspection.parcelUrl
          : null);
      // The operator's link comes from the immutable intake record, not from
      // `lp_url`: research lanes write that column, so it is not a durable
      // account of what the operator supplied.
      const operatorEntryUrl = operatorLandPortalEntryUrlForDeal(dealCardId)
        ?? operatorLandPortalEntryUrl(getPropertyCardRow(cardId)?.lp_url);
      const retainedParcel = retainedEntryUrl
        ? { url: retainedEntryUrl, source: retainedInspection?.parcelUrlRecord?.source ?? 'retained:property_inspection.parcelUrl' }
        : operatorEntryUrl
          ? { url: operatorEntryUrl, source: 'operator:intake_landportal_url' }
          : null;
      const operatorSupplied = !!retainedParcel && retainedParcel.source === 'operator:intake_landportal_url';
      if (retainedParcel?.url) {
        logger.info({
          event: 'landportal_capture_direct_entry',
          cardId,
          source: retainedParcel.source,
        }, 'landportal_capture_direct_entry');
      }
      // Hands the subject over as soon as its facts are read; see the helper.
      const onLandPortalSubjectFacts = landPortalSubjectFactsHandoff({
        cardId, dealCardId, retainedUrl: retainedParcel?.url ?? null, onSubjectReady,
      });
      const result = await withBrowserMissionGate(() => runPropertyInspection({
        cardId,
        dealCardId,
        onLandPortalSubjectFacts,
        searchKey: {
          address: searchKey.address ?? undefined,
          apn: searchKey.apn ?? undefined,
          // Same county-local spelling rule as the subject-research inspection:
          // without it a fresh lead's confirmed state-form APN reaches no
          // LandPortal parcel, so no comp anchor and no parcel visuals exist.
          apnAlternates: jurisdictionLocalApnVariants(searchKey.apn),
          county: searchKey.county ?? undefined,
          state: searchKey.state ?? undefined,
          city: searchKey.city ?? undefined,
          owner: searchKey.owner ?? undefined,
          landPortalParcelUrl: retainedParcel?.url ?? undefined,
          // When the entry point is the OPERATOR'S own link, the record it opens
          // is checked against what the operator actually told us, not against
          // identity a previous unverified run guessed onto the card. On Deal 90
          // that guess was the neighbouring parcel's APN and owner, and checking
          // the operator's own link against it would have rejected the right
          // parcel and gone back to the search that produced the wrong one.
          // An accepted (verified) card is never overridden this way.
          operatorSuppliedSubject: operatorSupplied
            ? operatorSuppliedSubjectFor(dealCardId, cardId) ?? undefined
            : undefined,
        },
        // Discovery still attempts the practical county assessor/recorder
        // source after LandPortal establishes the subject. qPublic is
        // browser-only in Pickens County; skipping it when LP already supplied
        // core facts was the bootstrap defect that left official coverage
        // permanently "not attempted."
        mode: 'deep_record',
        timeoutMs: SUBJECT_INSPECTION_TIMEOUT_MS,
      }, {
        landPortalBrowser: makeLandPortalBrowser({ driver: makeLiveBrowserDriver('landportal') }),
        countyRecordsBrowser: makeCountyRecordsBrowser({ driver: makeLiveBrowserDriver('county_records') }),
        googleVisualConfigured: googleVisualConfiguredResolved(),
      }));
      persistPropertyInspection(cardId, result.inspection);
      // The capture retains its URL and facts without binding them to the
      // released subject. The next capability-owned beforeResolve transition
      // performs that association under the shared subject lock.
      const landPortalRoute = result.routes.find((route) => route.provider === 'LandPortal');
      const count = result.inspection.comparables?.length ?? 0;
      return {
        ok: landPortalRoute?.status === 'used' || count > 0,
        comparableCount: count,
        note: landPortalRoute?.note ?? 'LandPortal parcel read completed.',
      };
    }),
    captureMarketContext: async (id) => {
      const deal = getDealCard(id);
      const matrix = deal ? marketMatrixFor(deal) : null;
      const facts = matrix
        ? [{
            key: 'market_matrix',
            label: 'Market Matrix',
            value: (matrix as unknown as { summaryLine?: string; headline?: string }).summaryLine
              ?? (matrix as unknown as { headline?: string }).headline
              ?? 'Assembled for the subject market.',
            grade: 'likely_indication' as const,
            source: 'LandOS Market Matrix',
            sourceUrl: null,
            retrievedAt: new Date().toISOString(),
            note: null,
          }]
        : [];
      return { facts, summary: matrix ? 'Market Matrix assembled for the subject market.' : 'No Market Matrix is available for this market yet.' };
    },
    // The Universal Resolver's indexed-web identity lane.
    //
    // SEARCH runs on the governed free, keyless capability LandOS already
    // selected (`freeSearch.selected = duckduckgo-search`, pinned ddgs in the
    // Hermes venv) — no browser, no CDP, no API key, no paid credit. PAGES are
    // opened with the same government text transport `official-source-discovery`
    // uses. It answers one question, which exact parcel this lead refers to,
    // and it establishes nothing on its own: the resolver's identity gate does.
    indexedWebIdentity: {
      search: createHermesFreeSearch(),
      fetchText: defaultGovFetchText,
      maxQueries: 3,
      maxPages: 3,
      timeoutMs: 20_000,
    },
    // Jurisdiction enrichment on the U.S. Census Bureau's own geography
    // services: keyless, free, no browser. Every official parcel source is
    // selected by county, so a lead that names only a town cannot reach one
    // until this lane settles.
    jurisdictionEnrichment: { timeoutMs: 15_000 },
    });
    // The comparable-collection lane is the one collector that IS comping, so it
    // runs inside the Comps & Valuation Capability. Every other collector is
    // untouched, and the collection work itself is the same live lane.
    return {
      ...live,
      comparables: (ctx) => throughCompCollection(dealCardId, resolutionCaller, () => live.comparables(ctx)),
    };
  };

  // ── The Deal Intelligence parent mission (Phase 5) ─────────────────────────
  // ONE operator action creates ONE parent mission on the Phase 4 mission graph.
  // Its children reuse the collectors and research systems that already work;
  // its join is assembled and analysed into ONE current snapshot.
  /** True once LandOS holds a real point for the subject parcel itself. */
  const subjectHasCoordinates = (id: number, deal: ReturnType<typeof getDealCard>): boolean => {
    const cards = (Array.isArray(deal?.propertyCards) ? deal!.propertyCards : []) as Array<Record<string, unknown>>;
    const card = cards.find((row) => row.role === 'subject') ?? cards[0];
    const inspection = Number.isInteger(Number(card?.id)) ? loadPropertyInspection(Number(card?.id)) : null;
    const identity = propertyIntelligenceStore.primaryRun(id)?.snapshot?.identity.coordinates;
    return (num(card?.lat) ?? num(card?.latitude)
      ?? num(inspection?.parcelFacts['Centroid Latitude']) ?? num(inspection?.parcelFacts.Latitude)
      ?? num(identity?.lat)) != null;
  };

  const operatorMarketScanForDeal = async (
    id: number,
    deal: ReturnType<typeof getDealCard>,
    options: { force?: boolean } = {},
  ): Promise<MarketScanResult | null> => {
    if (!deal) return null;
    const cached = loadMarketScan<MarketScanResult>(id, 'market_scan');
    const answered = (status: string | undefined): boolean => status === 'found' || status === 'none_found';
    const cacheAnswered = !!cached
      && (answered(cached.payload.dataCenterWatch?.status) || answered(cached.payload.growthSignals?.status));
    // Freshness requires a real 20-mile proximity answer, not merely a cached
    // county search: a cached scan that never screened the radius must re-run.
    // A screen taken from the ZIP centroid is also stale the moment the subject
    // has real coordinates — the radius must be measured from the parcel.
    const cachedRoutes = cached?.payload.dataCenterWatch?.routesAttempted ?? [];
    // A brockovich route that reports `not_run` did NOT screen the radius.
    // Counting it as one kept a cached "no point to measure from" answer fresh
    // for a week — including after the subject's own coordinates arrived, which
    // is the exact condition that would let the screen finally run.
    const cachedScreenedRadius = cachedRoutes.some((route) => route.startsWith('brockovich') && !/\bnot_run\b/i.test(route));
    const cachedFromZipCentroid = cachedRoutes.some((route) => route.includes('subject zip centroid'));
    const cacheFresh = !options.force
      && cacheAnswered
      && cachedScreenedRadius
      && !(cachedFromZipCentroid && subjectHasCoordinates(id, deal))
      && Math.floor(Date.now() / 1000) - cached!.createdAt < 7 * 24 * 3600;
    if (cacheFresh) return rehydrateCachedAcreageMatrix(deal, cached!.payload);
    const cards = (Array.isArray(deal.propertyCards) ? deal.propertyCards : []) as Array<Record<string, unknown>>;
    const subject = cards.find((card) => card.role === 'subject') ?? cards[0];
    const subjectInspection = Number.isInteger(Number(subject?.id))
      ? loadPropertyInspection(Number(subject?.id))
      : null;
    const dd = getDealCardDd(id);
    const scan = await runMarketScan({
      county: str(subject?.county) || dd.county || undefined,
      state: str(subject?.state) || dd.state || undefined,
      // Local coverage names the town, not the county, so the subject's own
      // city and ZIP both widen the query and tighten the geographic screen.
      city: str(subject?.city) || undefined,
      zip: str(subject?.zip)
        || extractZipCandidate(str(subject?.active_input_address) ?? '')
        || undefined,
      search: marketScanSearch(),
      internalCountySnapshots: internalCountySnapshotsForDeal(deal),
      subjectAcres: num(subject?.acres),
    });
    // ── Brockovich AI Data Center Reporting: the 20-mile subject screen ──────
    //
    // Runs on EVERY lead, keyless and browserless, against the same published
    // datasets the Brockovich map itself plots. It is the primary route because
    // it is the only one that actually measures a radius; the county web search
    // above contributes operating / under-construction / proposed activity that
    // no community report would carry, and the browser map is attempted only as
    // screenshot evidence once something is already known to be nearby.
    // THE SUBJECT'S OWN COORDINATES ARE THE POINT OF MEASURE. Every place LandOS
    // may hold one is tried — the card, the LandPortal parcel panel, the
    // accepted identity, and the resolution snapshot — before any coarser
    // stand-in is considered.
    const acceptedIdentityCoordinates = propertyIntelligenceStore.primaryRun(id)?.snapshot?.identity.coordinates;
    const resolutionCoordinates = (readResolutionSnapshot(id) as unknown as {
      coordinates?: { lat?: unknown; lng?: unknown };
      subject?: { coordinates?: { lat?: unknown; lng?: unknown } };
    } | null);
    const lat = num(subject?.lat)
      ?? num(subject?.latitude)
      ?? num(subjectInspection?.parcelFacts['Centroid Latitude'])
      ?? num(subjectInspection?.parcelFacts.Latitude)
      ?? num(acceptedIdentityCoordinates?.lat)
      ?? num(resolutionCoordinates?.coordinates?.lat)
      ?? num(resolutionCoordinates?.subject?.coordinates?.lat);
    const lng = num(subject?.lng)
      ?? num(subject?.longitude)
      ?? num(subjectInspection?.parcelFacts['Centroid Longitude'])
      ?? num(subjectInspection?.parcelFacts.Longitude)
      ?? num(acceptedIdentityCoordinates?.lng)
      ?? num(resolutionCoordinates?.coordinates?.lng)
      ?? num(resolutionCoordinates?.subject?.coordinates?.lng);

    // ONLY when the subject truly has no location: fall back to its ZIP's
    // retained Census ZCTA centroid, and say which basis was used. Proximity
    // only — per invariant 3 this never touches parcel identity.
    const subjectZip = str(subject?.zip)
      || extractZipCandidate(str(subject?.active_input_address) ?? '')
      || null;
    let fallbackPoint: { lat: number; lng: number } | null = null;
    if (lat == null || lng == null) {
      if (subjectZip) fallbackPoint = await zipCentroid(subjectZip).catch(() => null);
    }
    const proximity = await runDataCenterProximityScreen({
      lat,
      lng,
      zip: subjectZip,
      zipPoint: fallbackPoint,
    });
    logger.info({
      dealCardId: id,
      status: proximity.status,
      basis: proximity.basis,
      hits: proximity.hits.length,
      unlocatedReports: proximity.unlocatedReports,
    }, 'brockovich_data_center_proximity_screen');

    // ── Resolve where the unnamed web candidates actually are ───────────────
    //
    // A search result that never names this county is not evidence the project
    // is far away. When the subject has a point of measure, each candidate's
    // stated place is geocoded and the REAL distance decides: inside the radius
    // it becomes a measured hit, outside it is genuinely elsewhere, and a place
    // that will not resolve stays unverified context rather than a counted hit.
    const webItems = [...(scan.dataCenterWatch.items ?? [])];
    const candidates = [...(scan.dataCenterWatch.unverifiedNearbyCandidates ?? [])];
    const stillUnverified: typeof candidates = [];
    let measuredElsewhere = 0;
    if (proximity.subject && candidates.length) {
      const geocode = createPlaceGeocoder();
      // Bounded: this is a location check on a handful of candidates, not a
      // geocoding sweep.
      for (const candidate of candidates.slice(0, 6)) {
        const resolved = await resolveCandidateLocation(
          `${candidate.title} ${candidate.summary}`,
          proximity.subject,
          geocode,
        ).catch(() => null);
        if (!resolved) { stillUnverified.push(candidate); continue; }
        if (resolved.distanceMiles <= DATA_CENTER_SCREEN_RADIUS_MILES) {
          webItems.push({
            ...candidate,
            location: candidate.location ?? resolved.place,
            distanceMiles: resolved.distanceMiles,
            locationConfidence: 'distance_verified',
          });
        } else {
          measuredElsewhere += 1;
        }
      }
      stillUnverified.push(...candidates.slice(6));
    } else {
      stillUnverified.push(...candidates);
    }
    logger.info({
      dealCardId: id,
      candidates: candidates.length,
      promoted: webItems.length - (scan.dataCenterWatch.items ?? []).length,
      measuredElsewhere,
      stillUnverified: stillUnverified.length,
    }, 'data_center_candidate_location_resolution');

    const proximityItems = proximity.hits.map((hit) => ({
      title: hit.title,
      operatorOrDeveloper: hit.operatorOrDeveloper,
      location: hit.location,
      distanceMiles: hit.distanceMiles,
      status: 'community_opposition' as const,
      summary: hit.summary,
      whyItMatters: 'A community-reported data-center or energy-infrastructure project inside the subject’s 20-mile trade area can signal institutional land demand and utility investment ahead of price.',
      url: hit.sourceUrl,
      year: hit.reportedOn ? Number(hit.reportedOn.slice(0, 4)) || null : null,
      source: 'brockovich_community_reports' as const,
      corroboration: null,
    }));
    const routesAttempted = [
      `brockovich_community_reports (${proximity.status}${proximity.basis ? `, from ${proximity.basis.replace(/_/g, ' ')}` : ''})`,
      `web_search (${scan.dataCenterWatch.status})`,
      `candidate_location_resolution (${candidates.length} candidate(s), ${measuredElsewhere} measured outside ${DATA_CENTER_SCREEN_RADIUS_MILES} mi, ${stillUnverified.length} unresolved)`,
    ];
    const combinedItems = [...proximityItems, ...webItems];
    const combinedStatus = proximity.status === 'found' || combinedItems.length
      ? 'found' as const
      : proximity.status === 'none_found' || scan.dataCenterWatch.status === 'none_found'
        ? 'none_found' as const
        : proximity.status === 'unavailable' || scan.dataCenterWatch.status === 'unavailable'
          ? 'unavailable' as const
          : 'not_run' as const;
    const candidateTail = stillUnverified.length
      ? ` ${stillUnverified.length} topical result(s) could not be located and are carried as unverified context, not as nearby activity.`
      : '';
    const elsewhereTail = measuredElsewhere
      ? ` ${measuredElsewhere} topical result(s) were geocoded and measured beyond ${DATA_CENTER_SCREEN_RADIUS_MILES} miles.`
      : '';
    // The web lane counted candidates BEFORE their locations were resolved.
    // Drop that provisional sentence so the verdict states one set of numbers.
    const webVerdict = (scan.dataCenterWatch.verdict ?? '')
      .replace(/\s*\d+ topical result\(s\) did not name this market[^.]*\./, '')
      .trim();
    scan.dataCenterWatch = {
      ...scan.dataCenterWatch,
      status: combinedStatus,
      items: combinedItems.slice(0, 12),
      unverifiedNearbyCandidates: stillUnverified.slice(0, 6),
      summary: `${proximity.verdict} ${scan.dataCenterWatch.summary}`.trim(),
      verdict: `${proximity.verdict} ${webVerdict}${elsewhereTail}${candidateTail}`.trim(),
      routesAttempted,
    };

    // Screenshot evidence only, and only when something is already known to be
    // nearby. Its failure can no longer downgrade the answer above.
    if (proximity.status === 'found' && !scan.dataCenterWatch.browserMapEvidence) {
      const browserState = await ensureBrowserSession().catch(() => 'unreachable' as const);
      const mapResult = await runBrockovichDataCenterMap({
        lat,
        lng,
        driver: makeLiveBrowserDriver('brockovich_data_center'),
      });
      logger.info({
        dealCardId: id,
        browserState,
        status: mapResult.status,
        projectCount: mapResult.projects.length,
        screenshotCaptured: !!mapResult.screenshotPath,
        note: mapResult.note,
      }, 'brockovich_data_center_map_result');
      routesAttempted.push(`brockovich_map_screenshot (${mapResult.status})`);
      if (mapResult.screenshotPath && mapResult.subject) {
        scan.dataCenterWatch.browserMapEvidence = {
          sourceUrl: mapResult.sourceUrl,
          subject: mapResult.subject,
          radiusMiles: mapResult.radiusMiles,
          screenshotPath: mapResult.screenshotPath,
          attemptedAt: mapResult.attemptedAt,
        };
      } else {
        scan.dataCenterWatch.note = `${scan.dataCenterWatch.note} Brockovich map screenshot: ${mapResult.note}`;
      }
    }
    if (answered(scan.dataCenterWatch.status) || answered(scan.growthSignals.status)) {
      saveMarketScan(id, 'market_scan', scan);
      return scan;
    }
    return cacheAnswered ? cached!.payload : scan;
  };

  // Explicit operator refresh for the primary Brockovich browser-map evidence.
  // The response never exposes the stored filesystem path; the existing
  // token-gated image route serves the screenshot after a successful capture.
  app.post('/api/landos/deal-cards/:id/data-center-map/refresh', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const deal = getDealCard(id);
    if (!deal) return c.json({ error: 'not found' }, 404);
    const scan = await operatorMarketScanForDeal(id, deal);
    const result = scan?.dataCenterWatch;
    return c.json({
      status: result?.status ?? 'not_run',
      summary: result?.summary ?? 'The data-center map did not return a result.',
      note: result?.note ?? null,
      sourceUrl: result?.browserMapEvidence?.sourceUrl ?? null,
      attemptedAt: result?.browserMapEvidence?.attemptedAt ?? null,
      projectCount: result?.items?.length ?? 0,
      screenshotUrl: result?.browserMapEvidence?.screenshotPath
        ? `/api/landos/deal-cards/${id}/data-center-map`
        : null,
    });
  });

  const researchAttemptStatus = (
    taskStatus: PublicIntelligenceRun['tasks'][number]['status'],
    attempts: number,
    evidenceCount: number,
  ): ResearchAttemptStatus => {
    if (taskStatus === 'succeeded') return evidenceCount > 0 ? 'retrieved' : 'useful_indication';
    if (taskStatus === 'partial') return evidenceCount > 0 ? 'useful_indication' : 'attempted_inconclusive';
    if (taskStatus === 'failed' || taskStatus === 'timed_out') return attempts > 0 ? 'not_run_system_failure' : 'not_run';
    if (taskStatus === 'unavailable') return attempts > 0 ? 'source_unavailable' : 'not_run';
    if (taskStatus === 'blocked') return attempts > 0 ? 'attempted_inconclusive' : 'not_run';
    return 'not_run';
  };

  const operatorResearchAttempts = (run: PublicIntelligenceRun | null): OperatorResearchAttempt[] => {
    if (!run) return [];
    return run.tasks.flatMap<OperatorResearchAttempt>((task) => {
      const actualProviders = (task.providerOutcomes ?? []).filter((outcome) => outcome.attemptCount > 0);
      const attempts = Math.max(task.attempts ?? 0, actualProviders.reduce((sum, outcome) => sum + outcome.attemptCount, 0));
      const firstEvidence = task.evidence.find((item) => !!item.sourceUrl);
      const common: OperatorResearchAttempt = {
        key: task.task,
        label: task.label,
        category: task.role,
        source: actualProviders.map((outcome) => outcome.providerId).join(', ')
          || firstEvidence?.sourceName
          || task.diagnostics.adapterId
          || 'No source connected',
        url: firstEvidence?.sourceUrl ?? null,
        attemptCount: attempts,
        status: researchAttemptStatus(task.status, attempts, task.evidence.length),
        result: task.finding?.summary ?? task.failureReason ?? task.operatorMessage ?? 'No result was returned.',
        artifactIds: task.evidence.map((item) => item.evidenceId),
        attemptedAt: task.startedAt || null,
      };
      if (task.diagnostics.adapterId !== 'practical_subject_government_attempts_v1') return [common];
      const exactSources = task.evidence
        .filter((item) => !!item.sourceUrl)
        .filter((item, index, all) => all.findIndex((candidate) =>
          candidate.sourceName === item.sourceName && candidate.sourceUrl === item.sourceUrl) === index);
      if (!exactSources.length) return [common];
      return exactSources.map((evidence) => {
        const limitation = evidence.limitation ?? 'The source was attempted; no source-specific result text was retained.';
        const attemptStatus = limitation.match(/Actual attempt status:\s*([a-z_]+)/i)?.[1]?.toLowerCase() ?? '';
        const status: ResearchAttemptStatus =
          /unavailable|error|failure/.test(attemptStatus) ? 'source_unavailable'
            : /not_found|no_match/.test(attemptStatus) ? 'not_found'
              : /retrieved|used/.test(attemptStatus) ? 'retrieved'
                : /partial|useful_indication/.test(attemptStatus) ? 'useful_indication'
                  : 'attempted_inconclusive';
        return {
          ...common,
          key: `${task.task}:${evidence.evidenceId}`,
          label: evidence.sourceName,
          source: evidence.sourceName,
          url: evidence.sourceUrl ?? null,
          attemptCount: 1,
          status,
          result: limitation,
          artifactIds: [evidence.evidenceId],
          attemptedAt: evidence.retrievedAt || task.startedAt || null,
        };
      });
    });
  };

  const dealOperatorContext = async (id: number): Promise<DealOperatorContext> => {
    const deal = getDealCard(id);
    if (!deal) throw new Error('deal card not found');
    const acquisition = getAcquisition(id);
    const profile = acquisition.profile;
    const people = (deal.people ?? []) as Array<Record<string, unknown>>;
    const person = people.find((row) => ['seller', 'lead_contact'].includes(String(row.role ?? ''))) ?? people[0];
    const cardId = subjectCardId(deal) ?? null;
    const publicRun = new PublicIntelligenceStore().load(id)?.run ?? null;
    const money = (value: unknown): number | null => {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      const parsed = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    };
    const normalizeNote = (value: unknown): string => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const propertyAddressNotes = new Set(
      ((Array.isArray(deal.propertyCards) ? deal.propertyCards : []) as Array<Record<string, unknown>>)
        .flatMap((card) => [card.active_input_address, card.address, card.situs, card.normalized_address])
        .map(normalizeNote)
        .filter(Boolean),
    );
    const normalizedLegacySellerNote = normalizeNote(deal.seller_notes);
    const legacySellerNoteIsAddress = normalizedLegacySellerNote.length > 8
      && [...propertyAddressNotes].some((address) =>
        address.length > 8
        && (normalizedLegacySellerNote === address
          || normalizedLegacySellerNote.startsWith(`${address} `)
          || address.startsWith(`${normalizedLegacySellerNote} `)));
    const legacySellerNote = legacySellerNoteIsAddress ? null : deal.seller_notes;
    const notes = [
      legacySellerNote,
      profile.motivation,
      profile.personalityNotes,
      profile.communicationStyle,
      ...(profile.sellerStatedFacts ?? []),
      ...acquisition.discovery.map((entry) => entry.rawNotes),
    ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
    const next = acquisitionNextAction(acquisition, { ddParcelVerified: true });
    const tasks = [
      { label: next.label, dueAt: profile.nextFollowUpDate ?? null, status: 'open' },
      ...(deal.nextActions ?? []).map((item) => ({
        label: String(item.action ?? item.label ?? item.summary ?? 'Review next action'),
        dueAt: typeof item.due_at === 'string' ? item.due_at : null,
        status: String(item.status ?? 'open'),
      })),
    ];
    const activity = cardId ? getCardActivity(cardId, 200) : [];
    const latestVision = cardId ? loadCardVisionAnalysis(cardId) : null;
    return {
      seller: {
        name: profile.name?.trim() || str(person?.name) || null,
        phone: profile.phone?.trim() || str(person?.phone) || null,
        email: profile.email?.trim() || str(person?.email) || null,
        notes,
        askingPrice: money(profile.askingPrice) ?? deal.asking_price,
        timeline: profile.timeline?.trim() || acquisition.discovery[0]?.timeline || null,
        responsiveness: acquisition.commLog.length ? `Last contact ${acquisition.commLog[0].at}; ${acquisition.commLog.length} retained communication(s).` : null,
        flexibility: profile.priceFlexibility?.trim() || null,
        decisionAuthority: profile.decisionMakers?.trim() || str(person?.authority_status) || null,
        ownershipContext: profile.relationshipToProperty?.trim() || str(person?.role) || null,
        followUpDate: profile.nextFollowUpDate?.trim() || null,
        offerHistory: activity.filter((event) => /offer/i.test(`${event.kind} ${event.summary}`)).map((event) => event.summary),
        communications: acquisition.commLog.map((entry) => ({ kind: `${entry.direction} ${entry.channel}`, at: entry.at, summary: entry.summary })),
        tasks,
      },
      researchAttempts: operatorResearchAttempts(publicRun),
      marketScan: await operatorMarketScanForDeal(id, deal),
      marketWorksheet: getDealCardMarket(id),
      visualAnalysis: latestVision ? {
        ok: latestVision.ok,
        model: latestVision.model,
        summary: latestVision.summary,
        analyzed: latestVision.analyzed,
        observations: latestVision.observations,
        note: latestVision.note ?? null,
      } : null,
    };
  };

  const dealIntelligenceCapabilities = (
    dealCardId: number,
    resolutionCaller: 'new_lead' | 'deal_card' | 'internal_workflow' = 'internal_workflow',
    resolutionMode: 'reuse' | 'refresh' = 'reuse',
  ): DealIntelligenceCapabilities => ({
    collectors: propertyIntelligenceCollectors(dealCardId, resolutionCaller, resolutionMode),
    // New Lead's valuation lane executes inside the Comps & Valuation
    // Capability. The computation it runs is the mission's own shared one.
    compsValuation: (input) => throughMissionValuation(dealCardId, resolutionCaller, input),
    // Post-resolution intelligence: property backstory, controlling land-use
    // authority, current zoning, and subdivision rules + feasibility. Keyless,
    // browserless, no paid provider. Each lane runs beside the existing ones.
    //
    // The three land-use and history lanes now execute INSIDE the two shared
    // capabilities, so New Lead, Tools and the Deal Card reach one zoning and
    // subdivision implementation and one property-history implementation. The
    // research itself is unchanged; only the invoker moved.
    ...throughLandUseCapabilities(dealCardId, resolutionCaller, livePostResolutionCapabilities()),
    // The existing LandPortal + county subject-research system, reused as a
    // child-mission capability. Phase 5 does not rebuild it.
    // Market Matrix + Market Pulse, read through the same code the Market tab uses.
    marketPulse: async (id: number) => {
      const deal = getDealCard(id);
      const canonical = canonicalPropertyInputForDeal(id);
      const marketContext = deal ? marketContextFor(deal) : null;
      const providerRunId = missionGraphStore.activeMission(DEAL_INTELLIGENCE_KIND, DEAL_INTELLIGENCE_SCOPE, id)?.missionId
        ?? `deal-${id}-market-${Date.now()}`;
      const contextAdapter = <T,>(input: {
        laneId: string;
        providerId: string;
        execute: () => Promise<T>;
        evidence: (result: T) => Array<{ field: string; value: unknown; sourceUrl?: string | null }>;
      }): PropertyProviderAdapter<T> => ({
        laneId: input.laneId,
        providerId: input.providerId,
        execute: input.execute,
        validate: () => ({
          valid: true,
          subjectClassification: 'context_only',
          checks: [{ check: 'context_provider_settled', passed: true, reason: `${input.providerId} returned an explicit handback.` }],
          rejectedEvidenceIds: [],
        }),
        normalize: (property, result) => input.evidence(result).filter((item) => item.value != null && String(item.value).trim()).map((item, index): NormalizedPropertyEvidence => ({
          id: `${input.laneId}:${item.field || index}`,
          propertyCardId: property.propertyCardId,
          dealCardId: property.dealCardId,
          providerId: input.providerId,
          field: item.field,
          value: item.value,
          subjectClassification: 'context_only',
          strength: 'context_only',
          sourceUrl: item.sourceUrl ?? null,
          retrievedAt: new Date().toISOString(),
          confidence: 'medium',
          kind: 'fact',
          validation: { valid: true, reasons: [] },
        })),
        status: (_property, _result, _validation, evidence) => evidence.length ? 'context_only' : 'unavailable',
      });
      const runLane = async <T,>(adapter: PropertyProviderAdapter<T>): Promise<T> => {
        if (!canonical) return adapter.execute({} as never);
        const result = await executePropertyProvider({ runId: providerRunId, property: canonical, adapter });
        return propertyResearchStore.persistProviderResult(result).execution.result as T;
      };
      // Market Matrix is a local read. Market Pulse and the grounded Market
      // Scan (including the Brockovich data-center research) are independent
      // provider lanes, so they must begin together after identity rather than
      // making one provider's latency a prerequisite for the other.
      const [matrix, marketPrerequisites, marketScan] = await Promise.all([
        runLane(contextAdapter({
          laneId: 'market_matrix', providerId: 'landos_market_matrix',
          execute: async () => deal ? marketMatrixFor(deal) : null,
          evidence: (result) => result ? [{ field: 'market_matrix', value: result }] : [],
        })),
        runMarketPrerequisiteWork({
          county: marketContext?.geography.county ?? null,
          state: marketContext?.geography.state ?? null,
          zip: marketContext?.geography.zip ?? null,
        }, {
          countyResearch: () => runLane(contextAdapter({
            laneId: 'county_market_research', providerId: 'landos_market_research',
            execute: async () => marketContext?.county.available ? marketContext.county : null,
            evidence: (result) => result ? [{ field: 'county_market_research', value: result }] : [],
          })),
          countyPulse: () => runLane(contextAdapter({
            laneId: 'county_market_pulse', providerId: 'landos_market_pulse',
            execute: () => marketPulseForDeal(id).catch(() => null),
            evidence: (result) => result?.marketPulse ? [{ field: 'market_pulse', value: result.marketPulse }] : [],
          })),
          zipResearch: () => runLane(contextAdapter({
            laneId: 'zip_market_research', providerId: 'landos_market_research',
            execute: async () => marketContext?.zip.available ? marketContext.zip : null,
            evidence: (result) => result ? [{ field: 'zip_market_research', value: result }] : [],
          })),
        }),
        runLane(contextAdapter({
          laneId: 'data_center', providerId: 'brockovich_data_center_map',
          execute: () => deal ? operatorMarketScanForDeal(id, deal).catch(() => null) : Promise.resolve(null),
          evidence: (result) => result?.dataCenterWatch ? [{ field: 'data_center_watch', value: result.dataCenterWatch, sourceUrl: result.dataCenterWatch.browserMapEvidence?.sourceUrl ?? null }] : [],
        })),
      ]);
      const pulseResult = marketPrerequisites.county_market_pulse.value as Awaited<ReturnType<typeof marketPulseForDeal>>;
      const pulse = pulseResult?.marketPulse ?? null;
      const now = new Date().toISOString();
      const facts: SnapshotFact[] = [];
      if (matrix) {
        const view = matrix as unknown as { summaryLine?: string; headline?: string; title?: string };
        facts.push({
          key: 'market_matrix',
          label: 'Market Matrix',
          value: view.summaryLine ?? view.headline ?? view.title ?? 'Resolved for the subject market.',
          grade: 'likely_indication',
          source: 'LandOS Market Matrix',
          sourceUrl: null,
          retrievedAt: now,
          note: null,
        });
      }
      if (pulse) {
        const view = pulse as unknown as { plainEnglish?: string; countyPricePerAcre?: { medianPpa?: number | null; sampleSize?: number | null; source?: string | null } };
        facts.push({
          key: 'market_pulse',
          label: 'Market Pulse',
          value: view.plainEnglish ?? 'Market Pulse assembled for the subject market.',
          grade: 'likely_indication',
          source: 'LandOS Market Pulse',
          sourceUrl: null,
          retrievedAt: now,
          note: pulseResult?.parcelConfirmed
            ? 'Parcel-attributed: the subject parcel is confirmed.'
            : 'Area context only: the subject parcel is not confirmed, so this is not parcel-attributed market data.',
        });
        const ppa = view.countyPricePerAcre;
        if (ppa?.medianPpa != null) {
          facts.push({
            key: 'market_pulse_ppa',
            label: 'County median $/acre',
            value: `$${Number(ppa.medianPpa).toLocaleString()}/acre from ${ppa.sampleSize ?? 0} closed sale(s)`,
            grade: 'likely_indication',
            source: ppa.source ?? 'LandOS Market Pulse',
            sourceUrl: null,
            retrievedAt: now,
            note: 'Market context only. Whether a valuation basis exists is decided by the value lane, never by a computable median.',
          });
        }
      }
      for (const task of Object.values(marketPrerequisites)) {
        if (task.status !== 'returned') continue;
        facts.push({
          key: task.id,
          label: task.id === 'county_market_research' ? 'County Market Research'
            : task.id === 'county_market_pulse' ? 'County Market Pulse' : 'ZIP Market Research',
          value: task.reason,
          grade: 'likely_indication',
          source: task.id === 'county_market_pulse' ? 'LandOS Market Pulse' : 'LandOS Market Research',
          sourceUrl: null,
          retrievedAt: now,
          note: task.geography ? `Geography: ${task.geography}.` : null,
        });
      }
      return {
        marketMatrix: matrix ?? null,
        marketPulse: pulse,
        marketScan,
        marketPrerequisites,
        facts,
        summary: matrix && pulse
          ? 'Market Matrix and Market Pulse assembled for the subject market.'
          : matrix
            ? 'Market Matrix assembled; no Market Pulse could be read for this market.'
            : pulse
              ? 'Market Pulse assembled; no Market Matrix resolved for this market.'
              : 'Neither a Market Matrix nor a Market Pulse could be assembled for this market. This is a LandOS coverage gap, not evidence that the market has no activity.',
      };
    },
    operatorContext: dealOperatorContext,
    operatorAnalyst: async (input) => {
      const deal = getDealCard(dealCardId);
      const cardId = deal ? subjectCardId(deal) : null;
      const model = process.env.BROWSER_VISION_MODEL || 'gemini-3-flash-preview';
      const previousVisualSnapshot = propertyIntelligenceStore
        .history(dealCardId, 10)
        .map((row) => row.snapshot)
        .find((snapshot) =>
          snapshot?.operatorAnalysis?.analyst.mode === 'multimodal_llm_assisted'
          && snapshot.operatorAnalysis.analyst.reviewedImages.length > 0) ?? null;
      return runWholeCardOperatorAnalyst({
        ...input,
        previousVisualSnapshot,
        images: cardId ? gatherCardImages(cardId) : [],
        generate: generateVisionContent,
        model,
      });
    },
  });

  const dealIntelligenceShape = dealIntelligenceDefinitionShape();

  /** SELECT-only read of the parent Deal Intelligence mission and its children. */
  const dealIntelligenceMissionView = (dealCardId: number) => {
    const view = readFanOutMission(dealIntelligenceShape, dealCardId, missionGraphStore);
    if (!view.mission) return null;
    return {
      label: dealIntelligenceShape.label,
      kind: DEAL_INTELLIGENCE_KIND,
      scope: DEAL_INTELLIGENCE_SCOPE,
      mission: {
        missionId: view.mission.missionId,
        sequence: view.mission.sequence,
        status: view.mission.status,
        trigger: view.mission.trigger,
        outcome: view.mission.outcome ?? view.join?.outcome ?? null,
        startedAt: view.mission.startedAt,
        completedAt: view.mission.completedAt,
        error: view.mission.error,
        failureCategory: view.mission.failureCategory,
      },
      children: view.children.map((child) => ({
        key: child.key,
        label: child.label,
        purpose: child.purpose,
        role: child.role,
        dependsOn: child.dependsOn,
        awaits: child.awaits,
        missionId: child.identity.missionId,
        group: child.identity.group,
        assignedRole: child.identity.assignedRole,
        agentKey: child.identity.agentKey,
        agentName: child.identity.agentName,
        agentGroup: child.identity.agentGroup,
        agentRole: child.identity.agentRole,
        implAgentId: child.identity.implAgentId,
        contributionSlot: child.identity.contributionSlot,
        acceptance: child.acceptance,
        provider: child.provider,
        status: child.status,
        summary: child.summary,
        failureCategory: child.failureCategory,
        failureMessage: child.failureMessage,
        retryable: child.retryable,
        startedAt: child.startedAt,
        completedAt: child.completedAt,
        durationMs: child.durationMs,
        attempt: child.attempt,
      })),
      join: view.join,
      history: view.history,
    };
  };

  // Once a survey settles the size, every retained sentence asserting that the
  // acreage bases disagree describes a decision that has been made. Those
  // sentences were written across ten places in a stored mission snapshot —
  // deal killers, blockers, missing information, specialist summaries, the
  // operator analysis — so correcting them one field at a time would leave the
  // next one behind. This is the same read-time presentation correction the
  // canonical acreage and current zoning already use: the stored run record is
  // never touched, and only the presented copy stops repeating a resolved
  // conflict as a live one.
  const ACREAGE_CONFLICT_SENTENCE =
    /[^.!?]*acreage bases disagree[^.!?]*[.!?]\s*/gi;
  const withoutSettledAcreageConflict = <T,>(value: T): T => {
    if (typeof value === 'string') {
      if (!/acreage bases disagree/i.test(value)) return value;
      const cleaned = value.replace(ACREAGE_CONFLICT_SENTENCE, '').trim();
      return (cleaned === '' ? null : cleaned) as unknown as T;
    }
    if (Array.isArray(value)) {
      return value
        .map((entry) => withoutSettledAcreageConflict(entry))
        .filter((entry) => entry != null) as unknown as T;
    }
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        out[key] = withoutSettledAcreageConflict(entry);
      }
      return out as unknown as T;
    }
    return value;
  };

  const propertyIntelligenceView = (dealCardId: number) => {
    propertyIntelligenceStore.reclaimStaleRuns();
    const primary = propertyIntelligenceStore.primaryRun(dealCardId);
    const latest = propertyIntelligenceStore.latestRun(dealCardId);
    const progressRun = latest ?? primary;
    const storedSnapshot = primary?.snapshot ?? null;
    // Presentation-policy corrections applied at READ time, system-wide, with
    // the stored run record untouched: the discovery-stage access rule (road
    // abutment evidence displays legal access as present) and specialist
    // delivery re-derived from the current accepted evidence (a stale
    // "blocked — no screenshots retained" row never undercounts research).
    // Canonical acreage is a read-time presentation correction too: after an
    // acreage/extent adoption the stored mission snapshot may still carry the
    // superseded subject size, and the CURRENT view must never present it as
    // current. The stored run record stays untouched; the superseded figure
    // remains retained inside the acreage-extent record with provenance.
    const canonicalExtentAcres = readAcreageExtentRecord(dealCardId)?.decision.canonicalAcres ?? null;
    const currentLandUseAtRead = buildRetainedLandUseIntelligenceView(dealCardId);
    const currentZoningAtRead = currentLandUseAtRead?.currentZoning ?? null;
    // A stored acreage-basis conflict is a read-time correction too. The
    // assessor roll and the GIS polygon disagree on most rural parcels and
    // always will; a recorded survey settles which figure governs, and from
    // that moment the stored sentence describes a decision that has been made.
    // Leaving it in the presented snapshot kept it in the dossier, so every
    // downstream read repeated an acreage conflict on a surveyed parcel with no
    // action left that could clear it. The stored run record stays untouched.
    const acreageSettledBySurvey = retainedSurveyedAcres(dealCardId) != null;
    const presentedSource = storedSnapshot
      ? {
          ...storedSnapshot,
          identity: (() => {
            const base = canonicalExtentAcres != null && storedSnapshot.identity.acres !== canonicalExtentAcres
              ? {
                  ...storedSnapshot.identity,
                  acres: canonicalExtentAcres,
                  acreageBasis: 'official_reported (canonical acreage reconciliation)',
                }
              : storedSnapshot.identity;
            if (!acreageSettledBySurvey) return base;
            return {
              ...base,
              conflicts: (base.conflicts ?? []).filter(
                (conflict: string) => !/acreage bases disagree/i.test(String(conflict)),
              ),
            };
          })(),
          dueDiligence: normalizeDiscoveryAccessItems(
            storedSnapshot.dueDiligence,
            storedSnapshot.identity.normalizedAddress ?? storedSnapshot.identity.situs,
          ).map((item) => currentZoningAtRead?.established && /zoning|land use/i.test(`${item.key} ${item.label}`)
            ? {
                ...item,
                verdict: 'good' as const,
                grade: 'confirmed_fact' as const,
                headline: `Current zoning: ${currentZoningAtRead.districtCode ?? currentZoningAtRead.statement ?? 'established'}.`,
                detail: `${currentZoningAtRead.statement ?? 'Current parcel-specific official zoning is established.'}${currentZoningAtRead.authorityName ? ` Authority: ${currentZoningAtRead.authorityName}.` : ''} Historical and requested districts remain history only.`,
                missing: [],
              }
            : item),
          specialists: rederiveSpecialistDelivery(storedSnapshot.specialists, storedSnapshot.evidence),
        }
      : null;
    let snapshot = presentedSource ? presentPropertyIntelligenceSnapshot(presentedSource) : null;
    if (snapshot && acreageSettledBySurvey) snapshot = withoutSettledAcreageConflict(snapshot);
    const dealForUtilities = getDealCard(dealCardId);
    const utilityPropertyCardId = dealForUtilities ? subjectCardId(dealForUtilities) : null;
    const utilityRecord = utilityPropertyCardId ? loadUtilityAvailabilityRecord(utilityPropertyCardId) : null;
    const utilityAvailability = utilityRecord
      ? projectUtilityAvailability(utilityRecord, {
        address: null, apn: null, county: null, state: null, acres: null,
      })
      : null;
    if (snapshot) {
      const deal = getDealCard(dealCardId);
      const acquisition = getAcquisition(dealCardId);
      const subject = ((deal?.propertyCards ?? []) as Array<Record<string, unknown>>)
        .find((card) => card.role === 'subject')
        ?? ((deal?.propertyCards ?? []) as Array<Record<string, unknown>>)[0]
        ?? {};
      const accessEvidence = [
        ...snapshot.facts.map((fact) => `${fact.key} ${fact.label} ${fact.value ?? ''}`),
        ...snapshot.dueDiligence.map((item) => `${item.key} ${item.label} ${item.headline} ${item.detail ?? ''}`),
      ].join(' ');
      const accessStatus =
        /\bprivate[- ]road(?: only)?\b/i.test(accessEvidence) ? 'private_road_only' as const
          : /\blandlocked\b.{0,30}\byes\b|\bno mapped (?:road )?contact\b/i.test(accessEvidence) ? 'no_mapped_contact' as const
            : /\blandlocked\b.{0,30}\bno\b|\broad frontage\b.{0,30}\d/i.test(accessEvidence) ? 'public_road_proximity' as const
              : 'unknown' as const;
      const zoning = snapshot.dueDiligence.find((item) => /zoning|land use/i.test(`${item.key} ${item.label}`)) ?? null;
      const identityUsable = snapshot.identity.state === 'confirmed'
        || (snapshot.identity.state === 'provisional' && snapshot.identity.discoveryUsable === true);
      const currentBlockers = snapshot.blockers.filter((blocker) => {
        if (identityUsable
          && /parcel identity.*(?:provisional|unidentified|missing|not (?:been )?identified)|subject identity.*(?:missing|unresolved)|confirm the parcel against/i.test(blocker)) return false;
        if (snapshot!.evidence.length
          && /evidence and property screenshots.*did not contribute|no screenshots, documents or source links have been retained/i.test(blocker)) return false;
        if (snapshot!.comps.sold.length
          && /no (?:accepted |retained )?(?:sold )?comparable|comparables.*did not contribute/i.test(blocker)) return false;
        if (snapshot!.valuation.priceable
          && /not priceable|no (?:defensible )?value basis/i.test(blocker)) return false;
        return true;
      });
      const synthesized = buildPropertyIntelligenceStrategies({
        identityState: snapshot.identity.state,
        discoveryIdentityUsable: snapshot.identity.discoveryUsable,
        identityBasis: snapshot.identity.discoveryBasis ?? snapshot.identity.explanation,
        // Canonical current acreage outranks the retained mission snapshot's
        // figure: strategy reasoning must never continue from a superseded
        // subject size after an acreage/extent adoption.
        subjectAcres: canonicalExtentAcres ?? snapshot.identity.acres,
        valuation: snapshot.valuation,
        dueDiligence: snapshot.dueDiligence,
        zoning: zoning?.headline ?? zoning?.detail ?? null,
        zoningKnown: !!zoning && !['unresolved_question', 'unavailable_public_record'].includes(zoning.grade),
        utilitiesKnown: utilityAvailability?.knowledge.fullyKnown ?? false,
        utilitiesSummary: utilityAvailability
          ? `${utilityAvailability.water.headline} ${utilityAvailability.sewer.headline}`
          : null,
        accessStatus,
        landHomeCompCount: snapshot.comps.landHomeOnly.length,
        acceptedSoldCount: snapshot.comps.sold.length,
        activeListingCount: snapshot.comps.active.length,
        missionBlockers: currentBlockers,
      });
      snapshot = presentPropertyIntelligenceSnapshot(presentedSource!, {
        strategies: synthesized.strategies,
        recommendation: synthesized.recommendation,
        extraBlockers: currentBlockers,
      });
      // The confirmed situs is often street-only. The operator's accepted lead
      // input retains the full address; when that input extends the confirmed
      // street it is exposed for display, together with the canonical
      // LandPortal property identifier retained on the subject card. Stored
      // identity fields are never rewritten.
      {
        const identityKeyOf = (value: string): string =>
          value.normalize('NFKC').replace(/[^a-zA-Z0-9]/g, '').toLocaleLowerCase('en-US');
        const situsStreet = snapshot.identity.situs ?? snapshot.identity.normalizedAddress;
        let displayAddress: string | null = null;
        let displayAddressType: 'numbered_situs' | 'landos_road_only' | 'parcel_description' | null = null;
        // The RECONCILED record wins over the raw lead text. Intake is evidence,
        // not truth: when a feed supplied a wrong ZIP, echoing the lead string
        // back would keep showing the operator a locality that identity
        // reconciliation already proved wrong (deal 83 displayed the Indiana ZIP
        // 46960 on a Michigan parcel long after the card carried 49690).
        const canonicalCity = str(subject.city);
        const canonicalState = str(subject.state);
        const canonicalZip = str(subject.zip);
        // The OFFICIAL situs of record (retained assessor-tax capability
        // ledger, a SELECT — never a research run) outranks the intake string
        // for display. A road-only official situs displays under the LandOS
        // "0 <Road>" convention: the leading 0 is LandOS-generated, never an
        // official street number, and is never persisted onto identity.
        const subjectCardIdForDisplay = subjectCardId(deal);
        const retainedAssessor = subjectCardIdForDisplay != null
          ? new CapabilityInvocationStore().latestForProperty(subjectCardIdForDisplay, dealCardId, ASSESSOR_TAX_CAPABILITY_ID)
          : null;
        const assessorFacts = retainedAssessor
          && (retainedAssessor.facts as { recordStatus?: unknown }).recordStatus === 'official_record_retrieved'
          ? (retainedAssessor.facts as { assessor?: { situsAddress?: unknown } }).assessor ?? null
          : null;
        const officialSitus = typeof assessorFacts?.situsAddress === 'string' ? assessorFacts.situsAddress : null;
        if (officialSitus) {
          const derived = deriveOperatorDisplayLocation({
            sourceDescription: situsStreet ?? null,
            officialSitus,
            city: canonicalCity || null,
            state: canonicalState || null,
            zip: canonicalZip || null,
          });
          if (derived.displayType === 'numbered_situs' || derived.displayType === 'landos_road_only') {
            displayAddress = derived.displayAddress;
            displayAddressType = derived.displayType;
          }
        }
        if (!displayAddress && situsStreet && canonicalZip && (canonicalCity || canonicalState)) {
          displayAddress = [
            situsStreet,
            [canonicalCity, [canonicalState, canonicalZip].filter(Boolean).join(' ')].filter(Boolean).join(', '),
          ].filter(Boolean).join(', ');
        }
        if (situsStreet && !displayAddress) {
          const rawLeadInput = getOpportunityByDealCardId(dealCardId).rawInput ?? '';
          // Tolerate an operator lead-in label ("New seller lead: 1487 …")
          // before the address; only the address-through-ZIP span is compared.
          const candidate = (rawLeadInput.split(/\r?\n/)[0] ?? '')
            .replace(/^[^:]{0,80}:\s*/, '')
            .match(/^(.*?\b\d{5}(?:-\d{4})?)(?!\d)/)?.[1]?.trim() ?? '';
          if (candidate
            && identityKeyOf(candidate).startsWith(identityKeyOf(situsStreet))
            && identityKeyOf(candidate).length > identityKeyOf(situsStreet).length) {
            displayAddress = candidate;
          }
        }
        snapshot.identity = {
          ...snapshot.identity,
          displayAddress: displayAddress ?? situsStreet ?? null,
          displayAddressType,
          zip: canonicalZip || null,
          city: canonicalCity || null,
          lpPropertyId: str(subject.lp_property_id) || null,
        };
      }
      // Direct LandPortal retakes are cumulative property-inspection evidence,
      // while the promoted intelligence snapshot is intentionally immutable.
      // Project the newest retained asset for each visual category into this
      // read without starting a mission or creating a second gallery record.
      const retainedVisualInspection = subjectCardId(deal) != null ? loadPropertyInspection(subjectCardId(deal)!) : null;
      const visualKey = (value: string): string | null => {
        const compact = value.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (/roadfrontage/.test(compact)) return 'road_frontage_aerial';
        // Wider-context captures are their own category: a newer context shot
        // must never displace the close-parcel hero, and vice versa.
        // The surrounding-area aerial is its own category, resolved BEFORE the
        // parcel-context bucket: it is a deliberately wider frame answering a
        // different question, and collapsing it into parcel_context would let
        // one displace the other.
        if (/surroundingarea|areacontext/.test(compact)) return 'surrounding_area_aerial';
        if (/landportaloverview|parcelcontext|widercontext|neighborcontext/.test(compact)) return 'parcel_context';
        if (/closeparcelaerial|parcelpage/.test(compact)) return 'close_parcel_aerial';
        // Contour must resolve before the 3D bucket: "Contour terrain view"
        // also matches the 3D bucket's terrain-view alias.
        if (/contour/.test(compact)) return 'contour_terrain_view';
        if (/front(?:side)?3d|3dterrain|terrainview/.test(compact)) return 'front_side_3d';
        if (/rear(?:side)?3d/.test(compact)) return 'rear_side_3d';
        if (/wetland/.test(compact)) return 'wetlands_overlay';
        if (/soil/.test(compact)) return 'soil_overlay';
        if (/terrain/.test(compact)) return 'contour_terrain_view';
        if (/fema|floodplain|floodoverlay/.test(compact)) return 'fema_flood_overlay';
        if (/comparablesmap|compsmap/.test(compact)) return 'comps_map';
        // Default 3D, buildability, and Street View captures are their own
        // categories; numbered street views resolve before the bare one.
        if (/default3d/.test(compact)) return 'default_3d';
        if (/buildab/.test(compact)) return 'buildability';
        if (/streetview2/.test(compact)) return 'street_view_2';
        if (/streetview3/.test(compact)) return 'street_view_3';
        if (/streetview4/.test(compact)) return 'street_view_4';
        if (/streetview5|corridorcrossing/.test(compact)) return 'street_view_5';
        if (/streetview/.test(compact)) return 'street_view';
        return null;
      };
      const retainedVisuals = new Map<string, NonNullable<ReturnType<typeof loadPropertyInspection>>['assets'][number]>();
      const resolvedSubjectCardId = subjectCardId(deal);
      for (const asset of retainedVisualInspection?.assets ?? []) {
        if (!usableInspectionAsset(asset)) continue;
        if (!resolvedSubjectCardId || !isAcceptedLandPortalVisualForProperty(asset.validation, resolvedSubjectCardId)) continue;
        const key = visualKey(`${asset.key} ${asset.label}`);
        if (key) retainedVisuals.set(key, asset);
      }
      const projectedVisualEvidence: SnapshotEvidenceItem[] = snapshot.evidence.flatMap((item): SnapshotEvidenceItem[] => {
        const key = visualKey(`${item.label} ${item.sourceType}`);
        const asset = key ? retainedVisuals.get(key) : null;
        // Inspection-backed visual evidence with a missing/blank retained file
        // is omitted from every consumer. The persisted record remains intact.
        if (key && /landportal|inspection|direct action/i.test(`${item.sourceType} ${item.viewUrl ?? ''}`) && !asset) return [];
        if (!asset || subjectCardId(deal) == null) return [item];
        const subjectVisualVerified = asset.validation?.subjectClassification === 'verified_subject'
          && retainedVisualInspection?.parcelUrlRecord?.verifiedSubject === true;
        const label = subjectVisualVerified ? asset.label : `LandPortal context — ${asset.label}`;
        return [{
          ...item,
          id: `inspection-${asset.key}`,
          label,
          sourceType: subjectVisualVerified ? 'LandPortal direct action runner' : 'landportal_context',
          sourceUrl: retainedVisualInspection?.parcelUrl ?? item.sourceUrl,
          viewUrl: `/api/landos/inspection/image?cardId=${subjectCardId(deal)}&key=${encodeURIComponent(asset.key)}`,
          retrievedAt: asset.timestamp,
          confidence: subjectVisualVerified ? 'high' : 'low' as 'low' | 'high',
          supports: subjectVisualVerified ? asset.purpose : 'context_visual_evidence',
        }];
      });
      const presentVisualKeys = new Set(projectedVisualEvidence.map((item) => visualKey(`${item.label} ${item.sourceType}`)).filter((key): key is string => !!key));
      for (const [key, asset] of retainedVisuals) {
        if (presentVisualKeys.has(key) || subjectCardId(deal) == null) continue;
        const subjectVisualVerified = asset.validation?.subjectClassification === 'verified_subject'
          && retainedVisualInspection?.parcelUrlRecord?.verifiedSubject === true;
        const label = subjectVisualVerified ? asset.label : `LandPortal context — ${asset.label}`;
        projectedVisualEvidence.push({
          id: `inspection-${asset.key}`,
          kind: asset.kind === 'overlay' ? 'overlay' : 'screenshot',
          label,
          sourceType: subjectVisualVerified ? 'LandPortal direct action runner' : 'landportal_context',
          sourceUrl: retainedVisualInspection?.parcelUrl ?? null,
          viewUrl: `/api/landos/inspection/image?cardId=${subjectCardId(deal)}&key=${encodeURIComponent(asset.key)}`,
          retrievedAt: asset.timestamp,
          confidence: subjectVisualVerified ? 'high' : 'low' as 'low' | 'high',
          supports: subjectVisualVerified ? asset.purpose : 'context_visual_evidence',
          sha256: null,
          bytes: null,
        });
      }
      snapshot.evidence = projectedVisualEvidence;
      // Route-time projection keeps retained LandPortal sidebar evidence
      // visible on historical snapshots without starting a new mission. The
      // estimate is an additional source indication, never the LandOS working
      // value or a replacement for the comp-based valuation.
      const retainedInspection = subjectCardId(deal) != null ? loadPropertyInspection(subjectCardId(deal)!) : null;
      const estimateCapturedAt = retainedInspection?.sources
        .filter((source) => source.provider === 'LandPortal' && source.attemptedAt)
        .map((source) => source.attemptedAt as string)
        .sort()
        .at(-1)
        ?? snapshot.completedAt
        ?? primary?.updatedAt
        ?? null;
      const estimateFacts = Object.entries(retainedInspection?.parcelFacts ?? {})
        .filter(([label, value]) => value && (/^estimate\s*(price|ppa|price\s*per\s*acre|value|total)$/i.test(label.trim()) || /^lp\s*estimate\s*(price|ppa|value|total)?$/i.test(label.trim())))
        .map(([label, value]) => ({
          key: /ppa|price\s*per\s*acre/i.test(label) ? 'lpEstimatePerAcre' : 'lpEstimateTotal',
          label: /ppa|price\s*per\s*acre/i.test(label) ? 'LandPortal LP Estimate · Price per acre' : 'LandPortal LP Estimate · Total',
          value,
          grade: 'likely_indication' as const,
          source: 'LandPortal authenticated parcel sidebar',
          sourceUrl: retainedInspection?.parcelUrl ?? null,
          retrievedAt: estimateCapturedAt,
          note: 'Retained LandPortal subject estimate; additional source indication only. LandOS working value remains separate.',
        }));
      if (estimateFacts.length) {
        const seenEstimateKeys = new Set(snapshot.facts.filter((fact) => /^lpEstimate/.test(fact.key)).map((fact) => fact.key));
        snapshot.facts = [...snapshot.facts, ...estimateFacts.filter((fact) => !seenEstimateKeys.has(fact.key))];
      }
      // Retained LandPortal sidebar fields, projected with their exact labels
      // and displayed values. LandPortal is the discovery-stage source; a
      // stronger official record keeps its own fact and is never overwritten.
      // `normalize` exists because "verbatim" is only honest for a value the
      // panel actually displayed. The internal API answers the set-valued
      // fields with their Postgres literal, and a run that took that path
      // published "Water Feature Type {16}" to the operator on Deal 89.
      const sidebarFactDefs: Array<{ key: string; labels: string[]; factLabel: string; normalize?: (value: string) => string }> = [
        { key: 'lp_sidebar_water_feature_type', labels: ['Water Feature Type', 'Water Feature type(s)', 'Water Feature type'], factLabel: 'Water Feature Type', normalize: landPortalSetLabel },
        { key: 'lp_sidebar_zoning_code', labels: ['Zoning Code'], factLabel: 'Zoning Code' },
        { key: 'lp_sidebar_fema_flood_zone_description', labels: ['FEMA Flood Zone Description'], factLabel: 'FEMA Flood Zone Description' },
        { key: 'lp_sidebar_last_sale_price', labels: ['Last Sale Price'], factLabel: 'Last Sale Price' },
        { key: 'lp_sidebar_last_sale_date', labels: ['Last Sale Date'], factLabel: 'Last Sale Date' },
        { key: 'lp_sidebar_book_number', labels: ['Book Number'], factLabel: 'Book Number' },
        { key: 'lp_sidebar_page_number', labels: ['Page Number'], factLabel: 'Page Number' },
        { key: 'lp_sidebar_assessed_value', labels: ['Assessed Value'], factLabel: 'Assessed Value' },
      ];
      const sidebarFacts = sidebarFactDefs.flatMap(({ key, labels, factLabel, normalize }) => {
        const displayed = labels
          .map((label) => str(retainedInspection?.parcelFacts?.[label]))
          .find((candidate) => candidate && candidate !== '-');
        const value = displayed && normalize ? normalize(displayed) : displayed;
        if (!value) return [];
        return [{
          key,
          label: `LandPortal sidebar · ${factLabel}`,
          value,
          grade: 'likely_indication' as const,
          source: 'LandPortal authenticated parcel sidebar — discovery stage',
          sourceUrl: retainedInspection?.parcelUrl ?? null,
          retrievedAt: estimateCapturedAt,
          note: 'Displayed LandPortal sidebar value retained verbatim. Discovery-stage source; a stronger official record supersedes it in its own lane.',
        }];
      });
      if (sidebarFacts.length) {
        const seenSidebarKeys = new Set(snapshot.facts.filter((fact) => /^lp_sidebar_/.test(fact.key)).map((fact) => fact.key));
        snapshot.facts = [...snapshot.facts, ...sidebarFacts.filter((fact) => !seenSidebarKeys.has(fact.key))];
      }
      const persistedSpecialistStates = snapshot.specialists;
      const currentFact = (pattern: RegExp): string | null => {
        const fact = snapshot!.facts.find((item) => item.value && pattern.test(`${item.key} ${item.label}`));
        return fact?.value ?? null;
      };
      snapshot.specialists = snapshot.specialists.map((specialist) => {
        if (specialist.id === 'parcel_identity' && identityUsable) {
          return { ...specialist, status: 'completed', summary: `Practical subject identity is confirmed for discovery: ${snapshot!.identity.apn ?? 'APN retained'} · ${snapshot!.identity.county ?? 'jurisdiction retained'} · ${snapshot!.identity.acres ?? 'acreage retained'} acres.` };
        }
        if (specialist.id === 'government_records' && identityUsable) {
          return { ...specialist, status: 'partial', summary: 'Practical parcel identity is confirmed for discovery. Official county, deed, title, and recorded-instrument retrieval remains normal offer-stage diligence and does not block analysis.' };
        }
        if (specialist.id === 'zoning_land_use' && identityUsable) {
          return { ...specialist, status: 'partial', summary: 'Practical parcel identity is confirmed. Governing zoning and subdivision rules remain normal diligence; the missing official zoning record does not put the Deal Card back into Resolution.' };
        }
        if (specialist.id === 'environmental_terrain') {
          const retained = [
            currentFact(/wetland/),
            currentFact(/fema|flood/),
            currentFact(/buildab/),
            currentFact(/under[_\s-]*(?:10|ten).*slope|slope.*(?:10|ten)/),
          ].filter(Boolean);
          if (retained.length) return { ...specialist, status: 'partial', summary: `Retained parcel screening: ${retained.join(' · ')}. Provider screening is usable for current analysis; field and official-source confirmation remain normal diligence.` };
        }
        if (specialist.id === 'access_utilities') {
          const retained = [currentFact(/landlocked|land locked/), currentFact(/road[_\s-]*frontage|frontage feet/)].filter(Boolean);
          if (retained.length) return { ...specialist, status: 'partial', summary: `Retained access screening: ${retained.join(' · ')}. Legal access and parcel-level utility service remain to be confirmed.` };
        }
        if (specialist.id === 'comparables' && snapshot!.comps.sold.length) {
          return { ...specialist, status: 'completed', summary: `${snapshot!.comps.sold.length} unique retained sold comparable(s) are active in the canonical comp registry and support the current valuation.` };
        }
        if (specialist.id === 'market_intelligence' && snapshot!.facts.some((fact) => /market_matrix/.test(fact.key))) {
          return { ...specialist, status: 'completed', summary: 'Native subject-band, overall-market, and county acreage-band Market Matrix evidence is active in the current read.' };
        }
        if (specialist.id === 'evidence_visuals' && snapshot!.evidence.length) {
          return { ...specialist, status: 'completed', summary: `${snapshot!.evidence.length} retained visual evidence item(s) are active in the normal Deal Card visual registry.` };
        }
        if (specialist.id === 'valuation' && snapshot!.valuation.priceable) {
          return { ...specialist, status: 'completed', summary: `${snapshot!.comps.sold.length} retained sold comparable(s) support the current ${snapshot!.valuation.confidence}-confidence value range.` };
        }
        if (specialist.id === 'strategy' && synthesized.recommendation.preferredStrategy) {
          return { ...specialist, status: 'completed', summary: `All five approved strategies were recomputed from the current identity, property, comp, market, valuation, and seller evidence.` };
        }
        return specialist;
      });
      // Mission child state is historical execution truth. Route projection may
      // enrich facts, but it must not infer and overwrite task completion.
      snapshot.specialists = persistedSpecialistStates;
      if (identityUsable) {
        const staleIdentityGap = /parcel identity.*(?:provisional|unidentified|missing|not (?:been )?identified)|subject identity.*(?:missing|unresolved)|confirm the parcel against/i;
        snapshot.missingInformation = snapshot.missingInformation.filter((item) =>
          !staleIdentityGap.test(item)
          && !(snapshot!.evidence.length && /no screenshots, documents or source links have been retained/i.test(item)));
        snapshot.nextActions = snapshot.nextActions.filter((item) => !staleIdentityGap.test(item));
      }

      // The persisted package keeps the provider's native percentages. Format
      // those values once in the canonical read so every workspace shows both
      // percentage and approximate affected acres without screen-specific data.
      snapshot.facts = snapshot.facts.map((fact) => {
        if (!['wetlands', 'fema', 'under_ten_slope'].includes(fact.key) || snapshot!.identity.acres == null) return fact;
        const raw = String(fact.value ?? '').trim();
        const percent = Number(raw.replace(/[^0-9.-]/g, ''));
        if (!Number.isFinite(percent) || percent < 0 || percent > 100) return fact;
        const acres = (snapshot!.identity.acres! * percent) / 100;
        return { ...fact, value: `${percent.toFixed(2)}% · approximately ${acres.toFixed(2)} acres` };
      });

      const marketInspection = Number.isInteger(Number(subject.id)) ? loadPropertyInspection(Number(subject.id)) : null;
      const marketFactValue = (...labels: string[]): string | undefined => {
        for (const label of labels) {
          const value = str(marketInspection?.parcelFacts?.[label]);
          if (value && value !== '-') return value;
        }
        return undefined;
      };
      const marketState = str(subject.state) || marketFactValue('Parcel Address State') || snapshot.identity.state_ || undefined;
      const marketCounty = str(subject.fips) || str(subject.county) || marketFactValue('Parcel Address County') || snapshot.identity.county || undefined;
      const subjectZip = str(subject.zip) || marketFactValue('Parcel Address Zip Code') || (deal ? extractZipCandidate(str(subject.active_input_address) || str(deal.title)) : undefined);
      const retainedCountySnapshots = deal ? internalCountySnapshotsForDeal(deal) : [];
      const retainedPulseSample = retainedCountySnapshots
        .filter((row) => row.side === 'sold' && row.metrics.medianPricePerAcre != null)
        .sort((a, b) => b.period.localeCompare(a.period))[0] ?? retainedCountySnapshots[0] ?? null;
      const retainedPulseMetrics = retainedPulseSample?.metrics ?? null;
      const retainedPulseSummary = retainedPulseSample
        ? `Area context only: ${retainedPulseSample.coverage}. ${retainedPulseMetrics?.medianPricePerAcre != null ? `Median price per acre: $${Math.round(retainedPulseMetrics.medianPricePerAcre).toLocaleString('en-US')}. ` : ''}${retainedPulseMetrics?.populationGrowth != null ? `Population growth: ${retainedPulseMetrics.populationGrowth}%.` : 'Population growth is not established in the retained snapshot.'} Parcel-level valuation remains separate and is pending accepted closed subject-band evidence.`
        : null;
      const subjectMatrix = deal ? marketMatrixFor(deal) : null;
      const overallMatrix = deal ? buildMarketMatrixReportSection(resolveMarketMatrix({
        state: marketState,
        county: marketCounty,
        zip: subjectZip,
        acreageBand: 'all',
        side: 'sold',
      })) : null;
      const marketFact = (
        key: string,
        label: string,
        section: ReturnType<typeof resolveMarketMatrixSection> | null,
      ): SnapshotFact | null => {
        if (!section?.available) return null;
        const geographyLabel = section.coverageLevel === 'zip' && subjectZip
          ? `ZIP ${subjectZip}`
          : section.coverageLabel;
        const metrics = section.fields
          .filter((field) => !field.unknown && field.value != null)
          .map((field) => `${field.label}: ${field.value}`)
          .join(' · ');
        return {
          key,
          label: `${label} — ${geographyLabel}`,
          value: [
            section.acreageBandUsed,
            section.period,
            metrics,
          ].filter(Boolean).join(' · '),
          grade: 'likely_indication',
          source: section.source ?? section.provider ?? 'LandOS Market Matrix',
          sourceUrl: null,
          retrievedAt: primary?.updatedAt ?? snapshot!.completedAt ?? '',
          note: section.note,
        };
      };
      const pulseFact: SnapshotFact = {
        key: 'market_pulse',
        label: 'Market Pulse',
        value: overallMatrix?.available
          ? `Area context only: ${overallMatrix.coverageLabel} retained ${overallMatrix.period ?? 'a'} Market Research snapshot. ${overallMatrix.fields.filter((field) => !field.unknown && field.value != null).slice(0, 3).map((field) => `${field.label}: ${field.value}`).join(' · ') || 'Population growth and county pricing are not established in the retained snapshot.'} Parcel-level valuation remains separate and is pending accepted closed subject-band evidence.`
          : retainedPulseSummary ?? 'Area context only: population growth and county price-per-acre are not established in the retained Market Research snapshot.',
        grade: 'likely_indication',
        source: 'LandOS Market Research',
        sourceUrl: null,
        retrievedAt: primary?.updatedAt ?? snapshot.completedAt ?? '',
        note: 'Area context only; this summary does not establish subject parcel identity or valuation.',
      };
      const currentMarketFacts = [
        marketFact('market_matrix_subject', 'Subject acreage band', subjectMatrix),
        marketFact('market_matrix_overall', 'Overall market', overallMatrix),
      ].filter((fact): fact is SnapshotFact => fact != null);
      snapshot.facts = [
        ...snapshot.facts.filter((fact) => !['market_matrix', 'market_pulse', 'market_matrix_subject', 'market_matrix_overall'].includes(fact.key)),
        ...currentMarketFacts,
        pulseFact,
      ];

      const marketScan = retainedCountySnapshots.length
        ? {
            acreageMatrix: buildPracticalMarketMatrix({
              observations: [],
              internalCountySnapshots: retainedCountySnapshots,
              subjectAcres: num(subject.acres) ?? null,
            }),
          }
        : null;
      // The promoted snapshot is immutable and may predate comp rows accepted
      // later (for example an incremental Hermes import). Re-screen the
      // persisted canonical rows through the same source policy and working-set
      // selection the mission uses, and project them into this read when they
      // yield more operator-visible rows than the frozen snapshot. The stored
      // snapshot is never downgraded and never rewritten.
      {
        // Same source universe as the mission collector: the four approved
        // marketplaces including Realtor.com fallback rows. A row the collector
        // persists must survive this read, or refresh silently shrinks the
        // candidate universe.
        const persistedCompRows = listComps({ dealCardId }).filter((row) => {
          const source = `${row.canonical_source ?? ''} ${row.source_label ?? ''}`;
          if (/home\s*harvest|homeharvest|realie|really\.?ai/i.test(source)) return false;
          return /landportal|zillow|redfin|realtor(?:\.com)?/i.test(source);
        });
        const visibleCompRowCount = (comps: SnapshotComps): number =>
          comps.sold.length + comps.active.length + (comps.askingReferences?.length ?? 0) + comps.landHomeOnly.length;
        if (persistedCompRows.length) {
          const subjectMarketForRead: SubjectMarket = {
            state: marketState ?? null,
            county: marketCounty ?? null,
            zip: subjectZip ?? null,
            acres: num(subject.acres) ?? snapshot.identity.acres ?? null,
          };
          const candidatesForRead = persistedCompRows.map((row) => ({
            id: row.id,
            provider: row.canonical_source || row.source_label || 'Unknown',
            lane: row.price_kind === 'list' ? 'active' : 'sold',
            addressDesc: row.address_desc || null,
            apn: row.apn || null,
            state: row.state || marketState || null,
            price: typeof row.price === 'number' ? row.price : null,
            priceKind: row.price_kind || null,
            saleOrListDate: row.sale_or_list_date || null,
            acres: typeof row.acres === 'number' ? row.acres : null,
            pricePerAcre: typeof row.price_per_acre === 'number' ? row.price_per_acre : null,
            sourceUrl: row.source_url || null,
            distanceMiles: typeof row.distance_miles === 'number' ? row.distance_miles : null,
            thumbnailUrl: row.thumbnail_url || null,
            compClass: row.property_class || null,
            persistedStatus: row.status || null,
          } as CompRegistryCandidate));
          const policyForRead = applyCompSourcePolicy(subjectMarketForRead, candidatesForRead);
          const workingSetForRead = selectWorkingComps({
            subject: {
              acres: num(subject.acres) ?? snapshot.identity.acres ?? null,
              locality: null,
              county: marketCounty ?? null,
              address: snapshot.identity.situs ?? snapshot.identity.normalizedAddress ?? null,
              apn: snapshot.identity.apn ?? null,
            },
            rows: candidateRowsFromPolicy(policyForRead),
            nowMs: Date.now(),
            sourceCaps: policyForRead.plan.caps,
          });
          const currentComps = workingSetToSnapshotComps(workingSetForRead, {
            policyExplanation: policyForRead.plan.explanation,
            landPortalUsable: policyForRead.plan.landPortalUsable,
            landPortalRowsSeen: policyForRead.plan.landPortalRowsSeen,
            caps: policyForRead.plan.caps,
          });
          // Project the re-screened canonical rows when they yield more
          // visible rows than the frozen snapshot OR the same number: at equal
          // counts the same policy over the current canonical rows carries any
          // later-merged fields (address, sale date, thumbnail, attribution)
          // without dropping anything. Strictly fewer rows keeps the stored
          // snapshot — it is never downgraded.
          const currentCount = visibleCompRowCount(currentComps);
          const storedCount = visibleCompRowCount(snapshot.comps);
          if (currentCount > storedCount || (currentCount === storedCount && currentCount > 0)) {
            currentComps.landHomeSearchProof = snapshot.comps.landHomeSearchProof ?? null;
            snapshot.comps = currentComps;
          }
        }
        // Field-level enrichment: the frozen snapshot keeps its counts and
        // classifications, but it must not hide newer accepted canonical comp
        // fields merged after promotion (LandPortal Show on Map reconciliation
        // adds address, sale/list date, thumbnail, the comp's own source link,
        // and its merge attribution). Nothing is removed or reclassified here.
        {
          const compactKey = (value: unknown): string => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
          const canonicalByApn = new Map<string, ReturnType<typeof listComps>[number]>();
          for (const row of persistedCompRows) {
            const key = compactKey(row.apn);
            if (key) canonicalByApn.set(key, row);
          }
          const enrich = (comp: SnapshotComps['sold'][number]): void => {
            const row = canonicalByApn.get(compactKey(comp.apn));
            if (!row) return;
            if (!comp.address && row.address_desc) comp.address = row.address_desc;
            if (!comp.dateIso && row.sale_or_list_date) comp.dateIso = row.sale_or_list_date;
            if (!comp.thumbnailUrl && row.thumbnail_url) comp.thumbnailUrl = row.thumbnail_url;
            // The comp's own retained source page beats a generic subject-parcel
            // link; a missing link is filled the same way.
            if (row.source_url && (!comp.sourceUrl || comp.sourceUrl.includes('?property='))) comp.sourceUrl = row.source_url;
            try {
              const attributions = JSON.parse(row.source_attributions_json || '[]') as Array<{ provider?: string }>;
              for (const attribution of attributions) {
                const provider = str(attribution?.provider);
                if (!provider) continue;
                comp.providerAttributions = comp.providerAttributions ?? [];
                if (!comp.providerAttributions.some((existing) => existing.toLowerCase() === provider.toLowerCase())) {
                  comp.providerAttributions.push(provider);
                }
              }
            } catch { /* attribution enrichment is best-effort */ }
          };
          for (const bucket of [snapshot.comps.sold, snapshot.comps.active, snapshot.comps.landHomeOnly, snapshot.comps.askingReferences ?? []]) {
            for (const comp of bucket) enrich(comp);
          }
        }
      }
      const context = emptyDealOperatorContext();
      const people = (deal?.people ?? []) as Array<Record<string, unknown>>;
      const person = people.find((row) => ['seller', 'lead_contact'].includes(String(row.role ?? ''))) ?? people[0];
      const profile = acquisition.profile;
      const parseMoney = (candidate: unknown): number | null => {
        if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0) return candidate;
        const parsed = Number(String(candidate ?? '').replace(/[^0-9.-]/g, ''));
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
      };
      context.seller = {
        name: profile.name?.trim() || str(person?.name) || null,
        phone: profile.phone?.trim() || str(person?.phone) || null,
        email: profile.email?.trim() || str(person?.email) || null,
        notes: [
          profile.motivation,
          profile.personalityNotes,
          profile.communicationStyle,
          ...(profile.sellerStatedFacts ?? []),
          ...acquisition.discovery.map((entry) => entry.rawNotes),
        ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
        askingPrice: parseMoney(profile.askingPrice) ?? deal?.asking_price ?? null,
        timeline: profile.timeline?.trim() || acquisition.discovery[0]?.timeline || null,
        responsiveness: acquisition.commLog.length ? `Last contact ${acquisition.commLog[0].at}; ${acquisition.commLog.length} retained communication(s).` : null,
        flexibility: profile.priceFlexibility?.trim() || null,
        decisionAuthority: profile.decisionMakers?.trim() || (str(person?.authority_status) === 'unknown' ? null : str(person?.authority_status)) || null,
        ownershipContext: profile.relationshipToProperty?.trim() || null,
        followUpDate: profile.nextFollowUpDate?.trim() || null,
        offerHistory: [],
        communications: acquisition.commLog.map((entry) => ({ kind: `${entry.direction} ${entry.channel}`, at: entry.at, summary: entry.summary })),
        tasks: [],
      };
      context.marketScan = marketScan;
      context.marketWorksheet = getDealCardMarket(dealCardId);
      const packageForRead: DealIntelligenceInputPackage = {
        dealCardId,
        missionId: snapshot.missionId ?? snapshot.runId,
        identity: snapshot.identity,
        facts: snapshot.facts,
        marketIntelligence: {
          marketMatrix: subjectMatrix,
          marketPulse: overallMatrix ? { plainEnglish: overallMatrix.note } : null,
          marketScan,
        },
        governmentRecords: snapshot.governmentRecords,
        dueDiligence: snapshot.dueDiligence,
        comps: snapshot.comps,
        valuation: snapshot.valuation,
        strategies: snapshot.strategies,
        recommendation: snapshot.recommendation,
        evidence: snapshot.evidence,
        specialists: snapshot.specialists,
        gaps: [],
        requiredGaps: [],
        missionOutcome: snapshot.headline.confidenceWhy,
        missionStatus: snapshot.status === 'complete' ? 'joined' : 'joined_with_gaps',
        packageBlockers: snapshot.blockers,
        counts: {
          childrenTotal: snapshot.specialists.length,
          contributed: snapshot.specialists.filter((item) => item.status === 'completed' || item.status === 'partial').length,
          accepted: snapshot.specialists.filter((item) => item.status === 'completed').length,
          incomplete: snapshot.specialists.filter((item) => item.status !== 'completed').length,
        },
      };
      const canonicalState = canonicalDealStateFor(dealCardId, snapshot);
      snapshot.operatorAnalysis = buildDealOperatorAnalysis({
        pkg: packageForRead,
        context,
        previousSnapshot: storedSnapshot,
        generatedAt: primary?.updatedAt ?? snapshot.completedAt ?? '',
        canonical: canonicalState,
      });
      const bestCurrentStrategy = snapshot.valuation.priceable
        ? snapshot.operatorAnalysis.rankedStrategies[0]?.strategy ?? null
        : null;
      if (bestCurrentStrategy) {
        snapshot.recommendation = {
          ...snapshot.recommendation,
          preferredStrategy: bestCurrentStrategy,
          bestExit: bestCurrentStrategy,
          why: snapshot.operatorAnalysis.overall.mainOpportunity,
          postureWhy: `${snapshot.recommendation.posture === 'pursue' ? 'Pursue.' : snapshot.recommendation.posture === 'reject' ? 'Do not pursue on current terms.' : 'Hold.'} ${snapshot.operatorAnalysis.overall.recommendation}`,
        };
      } else if (!snapshot.valuation.priceable) {
        snapshot.recommendation = {
          ...snapshot.recommendation,
          preferredStrategy: null,
          bestExit: null,
          why: 'Strategy selection is pending valuation evidence.',
          posture: 'hold',
          postureWhy: `Hold. Strategy selection is pending valuation evidence. ${snapshot.valuation.notPriceableReason ?? 'No defensible value basis is established.'}`,
        };
      }

      const currentGovernmentFacts = governmentFactsFromPublicRecordOutcomes(listPublicRecordOutcomes(dealCardId));
      if (currentGovernmentFacts.length) {
        const currentKeys = new Set(currentGovernmentFacts.map((fact) =>
          `${fact.label}\n${fact.value ?? ''}`.toLowerCase()));
        snapshot.governmentRecords = [
          ...currentGovernmentFacts,
          ...snapshot.governmentRecords.filter((fact) =>
            !currentKeys.has(`${fact.label}\n${fact.value ?? ''}`.toLowerCase())),
        ];
      }
      const currentGovernmentEvidence = governmentArtifactEvidence(
        dealCardId,
        readGovernmentRecordsForDeal(dealCardId)?.artifacts ?? [],
      );
      if (currentGovernmentEvidence.length) {
        const currentEvidenceIds = new Set(currentGovernmentEvidence.map((item) => item.id));
        snapshot.evidence = [
          ...currentGovernmentEvidence,
          ...snapshot.evidence.filter((item) => !currentEvidenceIds.has(item.id)),
        ];
      }
    }
    const linkDeal = getDealCard(dealCardId);
    const linkCardId = linkDeal ? subjectCardId(linkDeal) : null;
    const linkInspection = linkCardId ? loadPropertyInspection(linkCardId) : null;
    const subjectListing = linkCardId ? loadSubjectListingDetail(linkCardId) : null;
    // Only a CONFIRMED canonical identity may segregate retained evidence. An
    // unconfirmed guess must never quarantine a record that might be the subject.
    const subjectCanonicalApn = (() => {
      const canonical = resolveCanonicalIdentity(dealCardId);
      return canonical.confirmed ? canonical.apn : null;
    })();
    const landPortalFacts = linkInspection ? buildParcelFactSheet(linkInspection.parcelFacts) : null;
    const canonicalParcel = linkInspection?.parcelUrlRecord;
    const subjectParcel = canonicalParcel?.verifiedSubject && isVerifiedLandPortalSubjectUrl(canonicalParcel.url)
      ? {
          url: canonicalParcel.url,
          source: canonicalParcel.source,
          capturedAt: canonicalParcel.capturedAt,
          propertyCardId: canonicalParcel.propertyCardId,
          dealCardId: canonicalParcel.dealCardId ?? dealCardId,
          verifiedSubject: canonicalParcel.verifiedSubject,
          apn: canonicalParcel.apn,
          threeDCapture: linkInspection?.threeDCapture ?? null,
        }
      : null;
    if (snapshot) {
      // Two DIFFERENT roles, never collapsed into one field.
      //
      // `subjectParcelUrl` is canonical identity: a verified `?property=` link
      // whose token decodes to this parcel. Only that may stand in for identity
      // (PERMANENT_MEMORY invariants 2-4), so it keeps its existing hard gate.
      //
      // `operatorParcelEntryUrl` is navigation only: the LandPortal link the
      // operator actually supplied, typically a saved-map `?map=` URL. It names
      // a map view rather than a parcel, so it proves nothing — but it is still
      // an openable retained link, and withholding an operator's own link
      // because it is not proof is the defect, not the safeguard. A Deal that
      // was established FROM a LandPortal URL must be able to reopen it.
      const operatorParcelEntryUrl = operatorLandPortalEntryUrlForDeal(dealCardId)
        ?? operatorLandPortalEntryUrl(linkInspection?.parcelUrl)
        ?? (linkCardId ? operatorLandPortalEntryUrl(getPropertyCardRow(linkCardId)?.lp_url) : null);
      snapshot = {
        ...snapshot,
        subjectParcelUrl: subjectParcel?.url ?? null,
        operatorParcelEntryUrl,
        threeDCapture: subjectParcel?.threeDCapture ?? linkInspection?.threeDCapture ?? null,
      };
    }
    if (linkInspection?.threeDCapture?.decision === 'not_applicable' && snapshot) {
      snapshot.missingInformation = snapshot.missingInformation.filter((item) => !/3d|terrain screenshot|imagery/i.test(item));
    }
    // Retained Street View outcome for the subject: structured observations
    // (each carrying its evidentiary basis) and the explicit availability
    // record. Served from the durable inspection record; never fabricated.
    const streetViewProjection = (() => {
      const screenshot = snapshot?.evidence.find((item) => item.id === 'inspection-street_view' && !!item.viewUrl)
        ?? snapshot?.evidence.find((item) => /street view/i.test(item.label) && !!item.viewUrl)
        ?? null;
      const observations = (linkInspection?.visualObservations ?? [])
        .filter((item) => /street view/i.test(`${item.evidence ?? ''} ${item.label ?? ''}`));
      // A visual claim without its retained visual artifact is not operator
      // evidence. Keep the truthful availability state, but never render the
      // unsupported observation (the former gated-entrance defect).
      if (!screenshot) return observations.length
        ? { available: false, observations: [], screenshot: null, reason: 'Street View observations have no retained screenshot and are not presented as findings.' }
        : null;
      if (!observations.length) return { available: true, observations: [], screenshot: screenshot.viewUrl, reason: 'A retained Street View capture is available; no visual finding was forced.' };
      const unavailable = observations.some((item) => /unavailable/i.test(item.label));
      return { available: !unavailable, observations, screenshot: screenshot.viewUrl, reason: unavailable ? 'The retained Street View attempt did not expose usable coverage.' : 'Observation is backed by the retained Street View screenshot.' };
    })();
    // Specialist delivery refresh against the FINAL merged evidence: the
    // stored snapshot's evidence array can be empty while the read-time view
    // merges 10+ accepted inspection visuals in above, so the re-derivation
    // must run again here or a stale "blocked — no screenshots" row keeps
    // undercounting delivered research areas.
    if (snapshot) {
      const refreshed = rederiveSpecialistDelivery(snapshot.specialists, snapshot.evidence);
      const upgraded = refreshed.filter((record, index) => record !== snapshot!.specialists[index]);
      if (upgraded.length) {
        snapshot.specialists = refreshed;
        const required = refreshed.filter((record) => record.role === 'required');
        const delivered = required.filter((record) => record.status === 'completed' || record.status === 'partial');
        snapshot.headline = {
          ...snapshot.headline,
          confidenceWhy: snapshot.headline.confidenceWhy.replace(
            /\d+ of \d+ required specialists delivered/,
            `${delivered.length} of ${required.length} required specialists delivered`,
          ),
        };
        const upgradedLabels = upgraded.map((record) => record.label.toLowerCase());
        snapshot.missingInformation = snapshot.missingInformation.filter((item) =>
          !upgradedLabels.some((label) => String(item).toLowerCase().startsWith(`${label}: blocked`)));
        if (snapshot.status === 'complete_with_gaps' && delivered.length === required.length) {
          snapshot.status = 'complete';
        }
      }
    }
    // Discovery-stage access presentation: legal access (road abutment) and
    // the separate, purely visual apparent-entrance read. Both are projections
    // over accepted evidence; nothing is fabricated and the record is not
    // modified.
    const accessPresentation = (() => {
      if (!snapshot) return null;
      // `normalizedAddress` can legitimately be the assessor's parcel
      // description (for example "Map 042 Parcel 123"). The operator access
      // read needs the resolved street serving the subject when one exists.
      const situs = snapshot.identity.displayAddress ?? snapshot.identity.normalizedAddress ?? snapshot.identity.situs;
      const read = readDiscoveryAccess(snapshot.dueDiligence, situs);
      const entrance = apparentEntranceFromObservations(linkInspection?.visualObservations ?? [], read.road);
      // The captures actually retained for this subject. Every reference a
      // visual access observation may legitimately cite — the evidence id, the
      // served view URL, the content hash — so an observation naming a capture
      // that is absent is dropped by the ladder instead of displayed.
      const retainedAccessArtifacts = [
        ...(snapshot?.evidence ?? [])
          .filter((item) => item.viewUrl && (item.kind === 'screenshot' || item.kind === 'map' || item.kind === 'overlay'))
          .flatMap((item) => [item.id, item.viewUrl, item.sha256]),
        // Accepted inspection captures, which is what a worker handback names
        // in `artifact_key`. A rejected or missing asset never counts.
        ...(linkInspection?.assets ?? [])
          .filter((asset) => asset.validation?.status === 'accepted')
          .flatMap((asset) => [asset.key, asset.storedPath]),
      ].filter((value): value is string => !!value);
      // The Street View capture the entrance observation must cite. Null when
      // no usable capture was retained: the observation is then orphaned.
      const retainedStreetViewCapture = streetViewProjection?.available ? streetViewProjection.screenshot : null;
      const canonicalAccessEvidence: AccessEvidenceItem[] = linkCardId == null
        ? []
        : (propertyResearchStore.loadForProperty(linkCardId)?.evidence ?? [])
          .filter((entry) => /^access_evidence\.(?:parcel_flag|apparent_physical|reported_legal|verified_legal)\./.test(entry.field))
          .flatMap((entry): AccessEvidenceItem[] => {
            const value = entry.value as Record<string, unknown>;
            const tier = String(value.tier ?? '');
            const sourceKind = String(value.source_kind ?? value.sourceKind ?? '');
            const basis = String(value.basis ?? '');
            const weight = String(value.weight ?? '');
            if (!['parcel_flag', 'apparent_physical', 'reported_legal', 'verified_legal'].includes(tier)
              || !['landportal_parcel_flag', 'satellite_imagery', 'street_view', 'listing', 'listing_photo', 'official_record', 'other'].includes(sourceKind)
              || !['source_stated', 'direct_observation', 'reasonable_interpretation', 'recorded_instrument'].includes(basis)
              || !['confirmed', 'well_supported', 'likely', 'unresolved'].includes(weight)) return [];
            return [{
              tier: tier as AccessEvidenceItem['tier'],
              statement: String(value.statement ?? ''),
              sourceLabel: String(value.source_label ?? value.sourceLabel ?? 'Retained source'),
              sourceKind: sourceKind as AccessEvidenceItem['sourceKind'],
              basis: basis as AccessEvidenceItem['basis'],
              weight: weight as AccessEvidenceItem['weight'],
              sourceUrl: typeof value.source_url === 'string' ? value.source_url : entry.sourceUrl,
              observedAt: typeof value.observed_at === 'string' ? value.observed_at : entry.retrievedAt,
              // The capture the stored statement claims to have read. Absent
              // means the ladder drops it rather than rendering it.
              artifactRef: typeof value.artifact_key === 'string' ? value.artifact_key
                : typeof value.artifactRef === 'string' ? value.artifactRef
                : null,
            }];
          });
      if (read.landlocked === 'yes' && !canonicalAccessEvidence.some((item) => item.tier === 'parcel_flag')) {
        canonicalAccessEvidence.push({
          tier: 'parcel_flag',
          statement: 'LandPortal flags the parcel as landlocked because it does not directly front a recognized named road.',
          sourceLabel: 'LandPortal parcel panel',
          sourceKind: 'landportal_parcel_flag',
          basis: 'source_stated',
          weight: 'likely',
          sourceUrl: linkInspection?.parcelUrl ?? null,
          observedAt: linkInspection?.sources.find((source) => source.provider === 'LandPortal')?.attemptedAt ?? null,
        });
      }
      if (entrance.confirmed && !canonicalAccessEvidence.some((item) => item.tier === 'apparent_physical')) {
        // Credit the observation record's own evidence wording and confidence.
        // Attributing it to LandPortal contradicted the Street View panel on the
        // same page, which reports that no LandPortal Street View coverage was
        // confirmed for this frontage. The observation cites the retained
        // capture it was read from; with no capture retained it cites nothing
        // and the guard drops it instead of rendering an orphaned scene.
        const attribution = apparentEntranceAttribution(entrance);
        canonicalAccessEvidence.push({
          tier: 'apparent_physical',
          statement: entrance.observation || entrance.display,
          sourceLabel: attribution.sourceLabel,
          sourceKind: 'street_view',
          basis: 'direct_observation',
          weight: attribution.weight,
          sourceUrl: linkInspection?.parcelUrl ?? null,
          observedAt: linkInspection?.sources.find((source) => source.provider === 'LandPortal')?.attemptedAt ?? null,
          artifactRef: retainedStreetViewCapture,
        });
      }
      // Every item — stored, parcel-flag or entrance-derived — goes through the
      // one guard, against the captures actually retained.
      const reconciliation = presentDiscoveryAccessEvidence(canonicalAccessEvidence, {
        retainedArtifacts: [...retainedAccessArtifacts, ...(retainedStreetViewCapture ? [retainedStreetViewCapture] : [])],
      });
      // The entrance line is a visual claim like any other: it is shown only
      // while the ladder still carries a backed apparent-physical observation.
      // An orphaned observation reverts to the honest not-confirmed line rather
      // than surviving because it was once stored.
      const entranceSupported = entrance.confirmed && reconciliation.apparentPhysicalAccess;
      return {
        // Ordinary acquisition-screening access follows the LandOS operator
        // rule. Recorded/title proof remains a separate evidence rung.
        established: read.established || reconciliation.verifiedLegalAccess,
        providerSignal: read.providerSignal,
        road: read.road,
        legalAccess: reconciliation.verifiedLegalAccess
          ? reconciliation.byTier.verified_legal[0]?.statement ?? 'Verified by recorded instrument'
          : read.display,
        recordedLegalAccess: reconciliation.verifiedLegalAccess
          ? reconciliation.byTier.verified_legal[0]?.statement ?? 'Verified by recorded instrument'
          : null,
        frontageFt: read.frontageFt,
        apparentEntrance: entranceSupported ? entrance.display : 'Not confirmed from retained imagery',
        apparentEntranceConfirmed: entranceSupported,
        apparentEntranceObservation: entranceSupported ? entrance.observation : null,
        /** True when a stored entrance claim was dropped for citing no capture. */
        apparentEntranceOrphaned: entrance.confirmed && !entranceSupported,
        evidence: reconciliation,
      };
    })();
    // Soils & preliminary septic outlook: accepted overlay units joined with
    // the retained official USDA screening. Preliminary category only — never
    // a pass/fail or a fabricated percentage.
    const soilsSeptic = (() => {
      try {
        return buildSoilsSepticOutlook(
          soilDetailsForDealCard(dealCardId),
          linkCardId != null ? loadSoilsSepticScreening(linkCardId) : null,
        );
      } catch {
        return null;
      }
    })();
    // Missing-diligence reconciliation: the historical record keeps every
    // collector message, but the operator read supersedes any "not run /
    // remains in Resolution" claim whose category now has accepted
    // discovery-stage research, and condenses duplicates into one checklist.
    const missingDiligence = (() => {
      if (!snapshot) return null;
      const num = (value: string | null | undefined, pattern: RegExp): string | null => {
        const match = value ? value.match(pattern) : null;
        return match ? match[1] : null;
      };
      const dd = new Map(snapshot.dueDiligence.map((item) => [item.key, item]));
      // Conservative: a lane counts as officially resolved only on a clean
      // verdict; unknown/caution/risk keep the diligence item visible.
      const resolvedVerdict = (key: string): boolean => String(dd.get(key)?.verdict ?? '') === 'good';
      const access = dd.get('access');
      const terrain = dd.get('terrain');
      const frontage = num(access?.headline, /([\d.]+)\s*ft frontage/);
      const state = {
        identityVerified: linkInspection?.parcelUrlRecord?.verifiedSubject === true && !!snapshot.identity.apn,
        frontageFt: frontage != null ? Number(frontage) : null,
        wetlandsScreenedPct: (() => { const value = num(dd.get('wetlands')?.headline, /(\d+(?:\.\d+)?)/); return value ? `${value}%` : null; })(),
        femaScreenedPct: (() => { const value = num(dd.get('flood')?.headline, /(\d+(?:\.\d+)?)/); return value ? `${value}%` : null; })(),
        femaDescription: str(linkInspection?.parcelFacts?.['FEMA Flood Zone Description']) || null,
        soilUnitCount: soilDetailsForDealCard(dealCardId).length,
        slopePct: num(terrain?.headline, /([\d.]+)%\s*average slope/),
        buildabilityPct: num(terrain?.headline, /([\d.]+)%\s*buildability/),
        streetViewComplete: !!streetViewProjection && streetViewProjection.available,
        zoningCode: str(linkInspection?.parcelFacts?.['Zoning Code']) || null,
        zoningOfficialConfirmed: resolvedVerdict('zoning'),
        utilitiesConfirmed: utilityAvailability?.knowledge.fullyKnown ?? false,
        septicConfirmed: resolvedVerdict('septic'),
        officialRecordsRetrieved: false,
        valuationPriceable: snapshot.valuation.priceable === true,
        legalAccessRoad: accessPresentation?.established ? accessPresentation.road : null,
        corridorRightsUnresolved: (linkInspection?.visualObservations ?? []).some(
          (item) => /corridor/i.test(item.label ?? '') && /unconfirmed|unresolved|unknown/i.test(item.detail ?? ''),
        ),
        septicOutlookLabel: soilsSeptic?.categoryLabel ?? null,
      };
      const raw = [
        ...snapshot.missingInformation.map((item) => String(item ?? '')),
        ...(access?.missing ?? []),
      ];
      return reconcileMissingDiligence(state, raw);
    })();
    // Retained multi-view Visual Buyer Analysis (canonical read; the newest
    // retained analysis supersedes any earlier interpretation), plus the
    // concise buyer narrative that is the DEFAULT operator presentation.
    // Display applies the discovery-stage access terminology; the persisted
    // record itself is never rewritten.
    const visualBuyerAnalysis = presentBuyerAnalysisAccessLanguage(
      linkCardId != null ? loadVisualBuyerAnalysis(linkCardId) : null,
      accessPresentation?.established === true,
    );
    const visualBuyerNarrative = buildVisualBuyerNarrative(visualBuyerAnalysis, {
      legalAccessDisplay: accessPresentation?.established ? accessPresentation.legalAccess : null,
      apparentEntranceDisplay: accessPresentation?.apparentEntrance ?? null,
      marketInterpretation: (() => {
        try {
          const deal = getDealCard(dealCardId);
          return deal ? marketContextFor(deal)?.interpretation ?? null : null;
        } catch {
          return null;
        }
      })(),
    });
    const developmentIntelligence = (() => {
      const deal = getDealCard(dealCardId);
      const subject = ((deal?.propertyCards ?? []) as Array<Record<string, unknown>>)
        .find((card) => card.role === 'subject')
        ?? ((deal?.propertyCards ?? []) as Array<Record<string, unknown>>)[0]
        ?? {};
      const providerSignal = accessPresentation?.providerSignal === 'mapped_frontage_not_landlocked'
        ? `Provider reports mapped frontage${accessPresentation.road ? ` at ${accessPresentation.road}` : ''} and does not flag the parcel landlocked`
        : accessPresentation?.providerSignal === 'landlocked_flag'
          ? 'Provider flags the parcel landlocked'
          : 'Provider signal unresolved';
      const currentLandUse = buildRetainedLandUseIntelligenceView(dealCardId);
      return buildDevelopmentIntelligence({
        dealCardId,
        records: listPublicRecordOutcomes(dealCardId),
        acres: canonicalExtentAcres ?? snapshot?.identity.acres ?? num(subject.acres),
        owner: str(subject.owner) || null,
        providerAccessSignal: providerSignal,
        recordedLegalAccess: accessPresentation?.recordedLegalAccess
          ? accessPresentation.recordedLegalAccess
          : 'Not verified from a recorded instrument',
        surveyedFrontage: 'Not verified by a retained survey',
        physicalEntrance: accessPresentation?.apparentEntranceConfirmed
          ? accessPresentation.apparentEntrance
          : 'Not confirmed from retained imagery',
        accessEstablished: accessPresentation?.established === true,
        currentZoning: currentLandUse?.currentZoning ?? null,
      });
    })();
    return {
      snapshot,
      subjectParcel,
      streetView: streetViewProjection,
      missingDiligence,
      access: accessPresentation ? { ...accessPresentation, developmentIntelligence } : null,
      soilsSeptic,
      visualBuyerAnalysis,
      visualBuyerNarrative,
      developmentIntelligence,
      // Named research areas with the exact incomplete one, so the operator
      // never has to guess what "N of M delivered" is missing.
      researchStatus: snapshot ? researchStatusFrom(snapshot.specialists, snapshot.dueDiligence) : null,
      // The exact-address lane already retrieves and extracts listing pages.
      // This projects the LATEST attempt that actually retained pages, so the
      // operator can see which providers answered and what they published,
      // rather than the facts living only inside the run record.
      // Both branches are re-projected against the CONFIRMED canonical parcel:
      // a same-address record stating another APN is neighbouring evidence, not
      // the subject, whichever path retained it and however old the row is.
      exactAddressListings: reprojectSubjectListingDetail(subjectListing, subjectCanonicalApn)?.projection ?? (() => {
        const cardId = resolveSubjectPropertyCard(getDealCard(dealCardId)).cardId;
        if (cardId == null) return null;
        const attempts = propertyResearchStore.listLaneAttempts(cardId)
          .filter((attempt) => attempt.laneId === EXACT_ADDRESS_LANE_ID);
        if (!attempts.length) return null;
        const withPages = [...attempts].reverse()
          .find((attempt) => ((attempt.execution?.result as { pages?: unknown[] } | undefined)?.pages ?? []).length > 0);
        const chosen = withPages ?? attempts[attempts.length - 1];
        return projectExactAddressListingEvidence(
          chosen.execution?.result as Parameters<typeof projectExactAddressListingEvidence>[0],
          { canonicalApn: subjectCanonicalApn },
        );
      })(),
      subjectListing: reprojectSubjectListingDetail(subjectListing, subjectCanonicalApn),
      landPortalFacts,
      canonicalState: canonicalDealStateFor(dealCardId, snapshot),
      hermesLandPortal: getHermesLandPortalLaneProgress(dealCardId),
      providerResearch: (() => {
        const deal = getDealCard(dealCardId);
        const cardId = resolveSubjectPropertyCard(deal).cardId;
        if (cardId == null) return null;
        const canonical = propertyResearchStore.loadForProperty(cardId);
        if (!canonical) return null;
        return {
          contractVersion: canonical.contractVersion,
          propertyCardId: canonical.propertyCardId,
          updatedAt: canonical.updatedAt,
          lanes: Object.values(canonical.lanes),
          acceptedEvidenceCount: canonical.evidence.length,
          acceptedEvidence: canonical.evidence
            .filter((item) => item.providerId === 'hermes_landportal_import')
            .map((item) => ({
              id: item.id,
              field: item.field,
              value: item.value,
              kind: item.kind,
              subjectClassification: item.subjectClassification,
              sourceUrl: item.sourceUrl,
              retrievedAt: item.retrievedAt,
            })),
          rejectedEvidenceCount: canonical.rejectedEvidence.length,
          rejectedEvidence: canonical.rejectedEvidence.slice(-20),
        };
      })(),
      // In-flight progressive content: assembled at child-settle WRITE time and
      // stored on the run row; this read only serves what is stored (GET does no
      // provider work and no reassembly). Non-null only while the run is
      // running; completeRun clears it, and the promoted snapshot is untouched.
      progressive: progressRun && progressRun.status === 'running' ? progressRun.progress ?? null : null,
      // The parent mission the CURRENT snapshot was assembled from, alongside the
      // one in flight. Shown so the operator can see the snapshot is driven by a
      // real mission rather than a report that happened to run.
      mission: dealIntelligenceMissionView(dealCardId),
      run: progressRun
        ? {
            runId: progressRun.runId,
            sequence: progressRun.sequence,
            status: progressRun.status,
            trigger: progressRun.trigger,
            startedAt: progressRun.startedAt,
            completedAt: progressRun.completedAt,
            error: progressRun.error,
            failureCategory: progressRun.failureCategory,
            isPrimary: progressRun.isPrimary,
          }
        : null,
      specialists: progressRun && progressRun.status === 'running'
        ? propertyIntelligenceStore.listSpecialists(progressRun.runId).map((row) => ({
        id: row.id, label: row.label, role: row.role, status: row.status, summary: row.summary,
        failureCategory: row.failureCategory, failureMessage: row.failureMessage, retryable: row.retryable,
        evidenceCount: row.evidenceCount, startedAt: row.startedAt, completedAt: row.completedAt, durationMs: row.durationMs,
          }))
        : snapshot?.specialists ?? [],
      history: propertyIntelligenceStore.history(dealCardId, 10).map((row) => ({
        runId: row.runId, sequence: row.sequence, status: row.status,
        startedAt: row.startedAt, completedAt: row.completedAt, isPrimary: row.isPrimary,
      })),
      // Comps & Valuation workspace: read-time projection over the canonical
      // comp registry + retained research evidence. SELECT-only.
      compsValuation: (() => {
        const view = buildCompsValuationView(dealCardId);
        if (!view) return null;
        const research = linkCardId == null ? null : propertyResearchStore.loadForProperty(linkCardId);
        const researchRecord = research as unknown as {
          lanes?: Record<string, {
            latestAttemptStatus?: string; latestFailureReason?: string | null; latestAttemptAt?: string;
          }>;
          evidence?: Array<{ providerId?: string; field?: string; kind?: string; value?: unknown }>;
        } | null;
        const retainedFor = (pattern: RegExp): number => view.comps.filter((comp) => pattern.test(comp.source)).length;
        const inputFor = (lane: 'zillow' | 'redfin' | 'realtor'): CompLaneInput => {
          const raw = researchRecord?.lanes?.[lane];
          const statusEvidence = researchRecord?.evidence?.find((entry) => entry.providerId === lane && entry.field === `comparables.${lane}.attempt_status`);
          const stated = statusEvidence?.value as {
            status?: string; note?: string | null; candidates?: number;
            searchVerified?: boolean | null; laneRoutes?: CompLaneRouteOutcome[] | null;
          } | undefined;
          const candidateEvidence = researchRecord?.evidence?.filter((entry) => entry.providerId === lane && entry.kind === 'comp') ?? [];
          const candidates = raw
            ? typeof stated?.candidates === 'number' && Number.isFinite(stated.candidates) ? stated.candidates : candidateEvidence.length
            : null;
          const status = stated?.status ?? raw?.latestAttemptStatus ?? null;
          const failure = raw?.latestFailureReason ?? null;
          return {
            lane,
            attempted: !!raw,
            attemptStatus: status,
            failureReason: /error|fail/i.test(`${status} ${failure ?? ''}`) ? failure || stated?.note || `${lane} reported a failed result.` : null,
            blockedReason: /blocked|disabled|unavailable/i.test(`${status} ${stated?.note ?? ''}`) ? stated?.note || failure || `${lane} reported a blocked, disabled, or unavailable result.` : null,
            candidates,
            retained: raw && candidates != null ? Math.min(candidates, retainedFor(new RegExp(lane, 'i'))) : null,
            filteredReasons: candidates != null && candidates > 0 && retainedFor(new RegExp(lane, 'i')) === 0
              ? ['Returned candidates did not survive the vacant-land comparable policy.'] : [],
            // Route evidence is only claimed when the lane actually recorded it.
            // A run that predates the instrumentation stays silent about
            // verification rather than asserting either answer.
            searchVerified: typeof stated?.searchVerified === 'boolean' ? stated.searchVerified : null,
            routes: Array.isArray(stated?.laneRoutes) ? stated.laneRoutes : [],
          };
        };
        const landPortalAttempted = (linkInspection?.sources ?? []).some((source) => source.provider === 'LandPortal' && !!source.attemptedAt)
          || !!linkInspection?.parcelUrl;
        const landPortalCandidates = landPortalAttempted ? (linkInspection?.comparables?.length ?? 0) : null;
        const laneAccountability = buildCompLaneAccountability([
          {
            lane: 'landportal', attempted: landPortalAttempted,
            attemptStatus: landPortalAttempted ? 'retrieved' : null,
            candidates: landPortalCandidates,
            retained: landPortalAttempted ? retainedFor(/landportal/i) : null,
            retainedAs: 'primary or retained LandPortal evidence',
            filteredReasons: landPortalCandidates != null && landPortalCandidates > 0 && retainedFor(/landportal/i) === 0
              ? ['LandPortal rows did not survive transaction/property-type policy.'] : [],
          },
          inputFor('zillow'),
          inputFor('redfin'),
          inputFor('realtor'),
        ]);
        return { ...view, laneAccountability };
      })(),
      // Official parcel & GIS evidence: which government platform answered,
      // what it said about this parcel, and what stayed unresolved. Read-time
      // projection over the retained retrieval; SELECT-only.
      officialParcelGis: buildOfficialParcelGisView(dealCardId, (() => {
        // The official-records specialist reports its own attempt narrative. A
        // lane that ran and matched nothing must not be shown as never run.
        const specialist = (snapshot?.specialists ?? []).find((row) => row.id === 'government_records');
        if (!specialist || specialist.status === 'queued' || specialist.status === 'running') return null;
        return { ran: true, detail: specialist.summary ?? null };
      })()),
      // Land use, zoning and by-right subdivision: the legal determination
      // built on top of the parcel evidence. Read-time projection over the
      // retained determination; SELECT-only.
      landUse: buildLandUseView(dealCardId),
      // The current district's already-persisted adopted-code projection is a
      // separate source-race product. Join it here so a later GIS promotion of
      // the district does not strand the matching uses and dimensional rules.
      // SELECT-only: this never reruns zoning research.
      zoningStandards: readZoningStandards(dealCardId),
      // The source-racing lanes promote their own snapshots and never write a
      // land_use_determination row, so this is the only way their confirmed
      // authority, backstory and subdivision rules reach the panel.
      landUseIntelligence: buildRetainedLandUseIntelligenceView(dealCardId),
      // Property-tax payment status. Read-time projection over the labeled tax
      // fields the run retained plus the payment-status sources it actually
      // attempted. It never infers a standing, and when nothing resolved it
      // names the collecting office and the blocker instead of reporting the
      // question as unscreened.
      taxStatus: (() => {
        const inspection = linkCardId != null ? loadPropertyInspection(linkCardId) : null;
        const parcelFacts = inspection?.parcelFacts ?? {};
        const subjectCard = linkCardId != null ? getPropertyCard(linkCardId) : null;
        const authority = taxAuthorityFor({
          county: (subjectCard as Record<string, unknown> | null)?.county as string | undefined
            ?? str(parcelFacts['Parcel Address County']),
          state: (subjectCard as Record<string, unknown> | null)?.state as string | undefined
            ?? str(parcelFacts['Parcel Address State']),
        });
        // Labeled public fields only. The retained EVIDENCE rows carry the
        // county lane's own labels; the parcel fact map carries the provider's.
        const fields: Record<string, string | number | null | undefined> = {};
        for (const label of TAX_STATUS_FIELDS) {
          fields[label] = parcelFacts[label]
            ?? (inspection?.evidence ?? []).find((item) => item.label === label && item.status === 'verified')?.detail;
        }
        const answering = (inspection?.evidence ?? []).find((item) =>
          TAX_STATUS_FIELDS.includes(item.label as typeof TAX_STATUS_FIELDS[number]) && item.status === 'verified');
        return buildTaxStatusRead({
          fields,
          attempts: taxStatusAttemptsFromSources(inspection?.sources ?? []),
          sourceLabel: answering?.source ?? null,
          sourceUrl: answering?.url ?? null,
          authority,
        });
      })(),
    };
  };

  const propertyIntelligenceProgressView = (dealCardId: number) => {
    propertyIntelligenceStore.reclaimStaleRuns();
    const primary = propertyIntelligenceStore.primaryRun(dealCardId);
    const latest = propertyIntelligenceStore.latestRun(dealCardId);
    const progressRun = latest ?? primary;
    return {
      run: progressRun
        ? {
            runId: progressRun.runId,
            sequence: progressRun.sequence,
            status: progressRun.status,
            trigger: progressRun.trigger,
            startedAt: progressRun.startedAt,
            completedAt: progressRun.completedAt,
            error: progressRun.error,
            failureCategory: progressRun.failureCategory,
            isPrimary: progressRun.isPrimary,
          }
        : null,
      specialists: progressRun && progressRun.status === 'running'
        ? propertyIntelligenceStore.listSpecialists(progressRun.runId).map((row) => ({
            id: row.id, label: row.label, role: row.role, status: row.status, summary: row.summary,
            failureCategory: row.failureCategory, failureMessage: row.failureMessage, retryable: row.retryable,
            evidenceCount: row.evidenceCount, startedAt: row.startedAt, completedAt: row.completedAt, durationMs: row.durationMs,
          }))
        : primary?.snapshot?.specialists ?? [],
      snapshotStatus: primary?.snapshot?.status ?? null,
      progressive: progressRun && progressRun.status === 'running' ? progressRun.progress ?? null : null,
    };
  };

  // Read the joined snapshot + live specialist progress. SELECT-only: opening a
  // Deal Card never starts research, calls a provider, or writes evidence.
  app.get('/api/landos/deal-cards/:id/property-intelligence', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const deal = getDealCard(id);
    if (!deal) return c.json({ error: 'deal card not found' }, 404);
    const cardId = subjectCardId(deal) ?? null;
    const propertyIntelligence = propertyIntelligenceView(id);
    if (c.req.query('view') === 'workspace-v2') {
      return c.json({
        propertyIntelligence: {
          snapshot: propertyIntelligence.snapshot,
          streetView: propertyIntelligence.streetView,
          missingDiligence: propertyIntelligence.missingDiligence,
          access: propertyIntelligence.access,
          soilsSeptic: propertyIntelligence.soilsSeptic,
          visualBuyerAnalysis: propertyIntelligence.visualBuyerAnalysis,
          visualBuyerNarrative: propertyIntelligence.visualBuyerNarrative,
          researchStatus: propertyIntelligence.researchStatus,
          exactAddressListings: propertyIntelligence.exactAddressListings,
          compsValuation: propertyIntelligence.compsValuation,
          officialParcelGis: propertyIntelligence.officialParcelGis,
          landUse: propertyIntelligence.landUse,
          landUseIntelligence: propertyIntelligence.landUseIntelligence,
          landPortalFacts: propertyIntelligence.landPortalFacts,
          taxStatus: propertyIntelligence.taxStatus,
          // The reconciled acreage travels with the FIRST read the workspace
          // makes. It is the same shared answer Documents & Uploads and the
          // evidence-interpretation endpoint return - not a second selection
          // rule - and it is here so the header's first meaningful paint is
          // already the working acreage. Before this, the header rendered the
          // identity snapshot's GIS-derived figure for as long as the
          // secondary evidence read took to arrive, so the operator watched
          // the parcel change size on load.
          evidenceAcreage: evidenceAcreageFor(id),
        },
        marketContext: marketContextFor(deal),
        landPortalFacts: propertyIntelligence.landPortalFacts,
      });
    }
    return c.json({
      propertyIntelligence,
      // Historical uploads and retained evidence remain available without
      // reviving the obsolete operational-report projection.
      documentRegistry: documentRegistryForCard(cardId, { dealCardId: id }),
      parcelRoster: parcelRosterFor(deal),
      // SOP 10B read-time join; never sourced from LandPortal market panels.
      marketContext: marketContextFor(deal),
      canonicalState: propertyIntelligence.canonicalState,
      subjectListing: propertyIntelligence.subjectListing,
      landPortalFacts: propertyIntelligence.landPortalFacts,
      access: propertyIntelligence.access,
      streetView: propertyIntelligence.streetView,
      compsValuation: propertyIntelligence.compsValuation,
      officialParcelGis: propertyIntelligence.officialParcelGis,
      landUse: propertyIntelligence.landUse,
      zoningStandards: propertyIntelligence.zoningStandards,
      landUseIntelligence: propertyIntelligence.landUseIntelligence,
    });
  });

  // Official parcel & GIS projection alone, for refresh without re-reading the
  // whole property-intelligence record. SELECT-only.
  app.get('/api/landos/deal-cards/:id/official-parcel-gis', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    if (!getDealCard(id)) return c.json({ error: 'deal card not found' }, 404);
    const propertyIntelligence = propertyIntelligenceView(id);
    return c.json({
      officialParcelGis: propertyIntelligence.officialParcelGis,
      canonicalState: propertyIntelligence.canonicalState,
      subjectListing: propertyIntelligence.subjectListing,
      landPortalFacts: propertyIntelligence.landPortalFacts,
      access: propertyIntelligence.access,
      streetView: propertyIntelligence.streetView,
      marketContext: marketContextFor(getDealCard(id)!),
    });
  });

  // Run the official parcel & GIS lane for one deal. This is the only endpoint
  // here that touches the network, and it is explicitly operator-initiated:
  // opening a Deal Card must never start government research on its own.
  app.post('/api/landos/deal-cards/:id/official-parcel-gis/run', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const deal = getDealCard(id);
    if (!deal) return c.json({ error: 'deal card not found' }, 404);

    // Subject identity comes from the deal's own subject card. Nothing is
    // inferred and nothing is carried over from another property.
    const cardId = subjectCardId(deal);
    const card = cardId ? getPropertyCard(cardId) : null;
    if (!card) return c.json({ error: 'deal card has no subject property card' }, 409);

    // An operator may point the lane at the county's own official GIS when
    // LandOS could not discover it. The URL is recorded as platform knowledge
    // for the whole county, so it is supplied once and never again.
    const body = await c.req.json().catch(() => ({})) as { officialSourceUrl?: unknown };
    const supplied = typeof body.officialSourceUrl === 'string' ? body.officialSourceUrl.trim() : '';
    const operatorSeeds = /^https?:\/\//i.test(supplied)
      ? [{ url: supplied, label: 'Operator-supplied official source' }]
      : undefined;

    try {
      const run = await runOfficialParcelGis({
        dealCardId: id,
        address: card.active_input_address || undefined,
        city: card.city || undefined,
        state: card.state || undefined,
        zip: card.zip || undefined,
        county: card.county || undefined,
        apn: card.apn || undefined,
        owner: card.owner || undefined,
        knownAcres: typeof card.acres === 'number' ? card.acres : undefined,
        latitude: typeof card.lat === 'number' ? card.lat : undefined,
        longitude: typeof card.lng === 'number' ? card.lng : undefined,
      }, { operatorSeeds });
      return c.json({
        officialParcelGis: buildOfficialParcelGisView(id),
        // Attempt trail is operator-visible at a summary level only; service
        // metadata and request counts stay in the retained evidence record.
        attempts: run.attempts.map((a) => ({ family: a.family, outcome: a.outcome })),
      });
    } catch (err) {
      logger.error({ event: 'official_parcel_gis_run_failed', dealCardId: id, msg: (err as Error)?.message }, 'official_parcel_gis_run_failed');
      return c.json({ error: 'official parcel research failed', detail: (err as Error)?.message ?? 'unknown' }, 502);
    }
  });


  // ── Acquisition Intelligence ─────────────────────────────────────────────
  //
  // The layer above research. It reads the property file LandOS already built
  // and returns one acquisitions judgment. Two endpoints, and the split between
  // them is the whole persistence contract:
  //
  //   GET  … /acquisition-intelligence      SELECT-only. Opening or reloading a
  //                                         Deal Card returns the persisted read
  //                                         and NEVER runs a model.
  //   POST … /acquisition-intelligence/run  The explicit refresh. The only path
  //                                         that engages the Acquisition Analyst.

  /** The complete canonical property file for one Deal Card, assembled from the
   *  reads that already exist. Nothing here researches; every call is a SELECT.
   *  Retained visuals are resolved to their files on this machine so the analyst
   *  can actually look at them rather than read a URL. */
  /** Pure retained Market Pulse projection for specialist reasoning. It never
   * calls Census, search, geocoding, or the browser. Collector route narration
   * and filesystem paths are deliberately omitted. */
  const retainedMarketPulseForSpecialist = (dealCardId: number, propertyCardId: number | null): unknown => {
    const retained = propertyCardId != null ? propertyResearchStore.loadForProperty(propertyCardId) : null;
    const latestEvidence = (providerId: string, field: string) => (retained?.evidence ?? [])
      .filter((item) => item.providerId === providerId && item.field === field)
      .sort((a, b) => b.retrievedAt.localeCompare(a.retrievedAt))[0] ?? null;
    const pulse = latestEvidence('landos_market_pulse', 'market_pulse');
    const retainedDataCenter = latestEvidence('brockovich_data_center_map', 'data_center_watch');
    const cached = loadMarketScan<MarketScanResult>(dealCardId, 'market_scan');
    const scan = cached?.payload;
    return {
      contractVersion: 'market-pulse-specialist-file-v1',
      retainedMissionEvidence: {
        marketPulse: pulse ? {
          value: pulse.value,
          sourceUrl: pulse.sourceUrl,
          retrievedAt: pulse.retrievedAt,
          confidence: pulse.confidence,
        } : null,
        dataCenterWatch: retainedDataCenter ? {
          value: retainedDataCenter.value,
          sourceUrl: retainedDataCenter.sourceUrl,
          retrievedAt: retainedDataCenter.retrievedAt,
          confidence: retainedDataCenter.confidence,
        } : null,
      },
      marketScan: scan ? {
        area: scan.area,
        generatedAt: scan.generatedAt,
        dataCenterWatch: {
          status: scan.dataCenterWatch.status,
          area: scan.dataCenterWatch.area,
          summary: scan.dataCenterWatch.summary,
          verdict: scan.dataCenterWatch.verdict ?? null,
          whyItMatters: scan.dataCenterWatch.whyItMatters,
          generatedAt: scan.dataCenterWatch.generatedAt,
          items: scan.dataCenterWatch.items,
          unverifiedNearbyCandidates: scan.dataCenterWatch.unverifiedNearbyCandidates ?? [],
          mapEvidence: scan.dataCenterWatch.browserMapEvidence ? {
            sourceUrl: scan.dataCenterWatch.browserMapEvidence.sourceUrl,
            radiusMiles: scan.dataCenterWatch.browserMapEvidence.radiusMiles,
            attemptedAt: scan.dataCenterWatch.browserMapEvidence.attemptedAt,
          } : null,
        },
        growthSignals: {
          status: scan.growthSignals.status,
          area: scan.growthSignals.area,
          summary: scan.growthSignals.summary,
          generatedAt: scan.growthSignals.generatedAt,
          items: scan.growthSignals.items,
        },
        landMarketWeb: scan.landMarketWeb ?? null,
        acreageMatrix: scan.acreageMatrix ?? null,
      } : null,
      retainedAt: cached ? new Date(cached.createdAt * 1_000).toISOString() : null,
    };
  };

  const acquisitionPropertyFile = (dealCardId: number): AcquisitionPropertyFileSource | null => {
    const deal = getDealCard(dealCardId);
    if (!deal) return null;
    const cardId = subjectCardId(deal) ?? null;
    const inspection = cardId != null ? loadPropertyInspection(cardId) : null;
    const visuals = (inspection?.assets ?? [])
      .filter((asset) => usableInspectionAsset(asset))
      // Only imagery visual validation actually bound to THIS Property Card may
      // be reasoned over. A context capture from another parcel is not evidence
      // about this one.
      .filter((asset) => cardId != null && isAcceptedLandPortalVisualForProperty(asset.validation, cardId))
      .map((asset) => ({
        key: asset.key,
        label: asset.label,
        purpose: asset.purpose ?? asset.note ?? null,
        capturedAt: asset.timestamp ?? null,
        filePath: asset.storedPath ?? null,
      }));

    // GROUNDED visual observations only. Both retained lanes below persist the
    // output of the same analyzer that provably base64-encodes the image bytes
    // to a vision model (`analyzeScreenshots` → Gemini `inlineData`), so each
    // observation is marked pixelGrounded with its model and analysis time.
    // Nothing else may claim grounding: a pass that only held a file path is
    // not represented here at all.
    const captureTimeFor = (label: string | null | undefined): string | null =>
      (label ? visuals.find((visual) => visual.label === label)?.capturedAt ?? null : null);
    const groundedVisualObservations = (() => {
      if (cardId == null) return [];
      const analysis = loadCardVisionAnalysis(cardId);
      const fromAnalysis = analysis?.ok
        ? analysis.observations.map((observation) => ({
          category: observation.category,
          observation: observation.observation,
          signal: observation.signal,
          confidence: observation.confidence,
          sourceImage: observation.sourceImage,
          model: analysis.model,
          analyzedAt: analysis.generatedAt,
          capturedAt: captureTimeFor(observation.sourceImage),
          pixelGrounded: true,
        }))
        : [];
      // The persisted Visual Intelligence record is read through the same
      // eligibility sanitizer the operator surface uses.
      const rawVi = loadVisualIntelligence(cardId) as VisualIntelligenceRecord | null;
      const vi = rawVi
        ? sanitizeVisualIntelligenceRecord(rawVi, { eligibleGoogle: loadEligibleCardVisualCapture(cardId), rawGoogle: loadCardVisualCapture(cardId) })
        : null;
      const fromVi = (vi?.observations ?? []).map((observation) => ({
        category: observation.category,
        observation: observation.observation,
        signal: observation.signal,
        confidence: observation.confidence,
        sourceImage: observation.sourceImage,
        model: vi?.visionModel ?? null,
        analyzedAt: vi?.visionAnalyzedAt ?? vi?.generatedAt ?? null,
        capturedAt: captureTimeFor(observation.sourceImage),
        pixelGrounded: true,
      }));
      // The GEV spatial lane is ADDITIVE: it grounds different pixels (God's
      // Eye View captures) through the same base64→vision path, so its
      // observations append to whichever imagery lane wins rather than
      // competing with it.
      const gev = loadCardGevSpatialAnalysis(cardId);
      const fromGev = gev?.ok
        ? gev.observations.map((observation) => ({
          category: 'spatial_context',
          observation: `[${observation.view}] ${observation.observation}`,
          signal: observation.signal,
          confidence: observation.confidence,
          sourceImage: observation.sourceImage,
          model: gev.model,
          analyzedAt: gev.generatedAt,
          capturedAt: gev.generatedAt,
          pixelGrounded: true,
        }))
        : [];
      // Same analyzer behind both lanes — carry the newer run, not a merge of
      // observations that may describe superseded imagery.
      if (fromAnalysis.length && fromVi.length) {
        const analysisAt = Date.parse(analysis?.generatedAt ?? '') || 0;
        const viAt = Date.parse(vi?.visionAnalyzedAt ?? vi?.generatedAt ?? '') || 0;
        return [...(viAt > analysisAt ? fromVi : fromAnalysis), ...fromGev];
      }
      return [...(fromAnalysis.length ? fromAnalysis : fromVi), ...fromGev];
    })();

    return {
      dealCardId,
      propertyCardId: cardId,
      propertyIntelligence: propertyIntelligenceView(dealCardId) as unknown,
      marketContext: marketContextFor(deal) as unknown,
      marketPulse: retainedMarketPulseForSpecialist(dealCardId, cardId),
      documentRegistry: documentRegistryForCard(cardId, { dealCardId }) as unknown,
      dealCard: deal as unknown,
      // The one identity verdict every consumer evaluates from. A SELECT.
      canonicalIdentity: resolveCanonicalIdentity(dealCardId) as unknown,
      // The persisted seller evidence: Acquisitions CRM state (profile, comm
      // log, discovery) plus seller-stated fact rows. SELECTs over existing
      // stores — no new CRM, no research.
      acquisition: getAcquisition(dealCardId) as unknown,
      sellerStatedFacts: (cardId != null ? loadSellerStatedFacts(cardId) : []) as unknown,
      // The latest Assessor & Tax capability result from the invocation
      // ledger: the CURRENT official-record answer (or its honest absence)
      // that the reconciliation re-read reasons against. A SELECT.
      assessorTax: (cardId != null
        ? new CapabilityInvocationStore().latestForProperty(cardId, dealCardId, ASSESSOR_TAX_CAPABILITY_ID)
        : null) as unknown,
      // The retained official acreage / parcel-extent reconciliation. Its
      // canonical current acreage outranks the mission snapshot's figure in
      // the dossier, so a stale snapshot can never silently feed the analyst
      // a superseded subject size. A SELECT.
      acreageExtent: readAcreageExtentRecord(dealCardId) as unknown,
      visuals,
      visualObservations: groundedVisualObservations,
    };
  };

  /**
   * In-flight Acquisition Intelligence runs, by Deal Card.
   *
   * The analyst reasons locally over a full property file and inspects the
   * retained imagery, which takes minutes rather than seconds. Holding an HTTP
   * request open for that long is the fragile way to do it — a sleeping laptop,
   * a navigation, or any proxy in between loses the run and the operator never
   * learns whether it finished. So the POST STARTS the run and returns, and the
   * SELECT-only GET reports whether one is in flight. Same fire-and-poll shape
   * the LandPortal pilot already uses for long work.
   *
   * In memory on purpose: an interrupted process has no in-flight run, and the
   * persisted read is the durable record.
   */
  const acquisitionIntelligenceRuns = new Map<number, { startedAt: string; error: string | null }>();

  app.get('/api/landos/deal-cards/:id/acquisition-intelligence', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    if (!getDealCard(id)) return c.json({ error: 'deal card not found' }, 404);
    const read = readAcquisitionIntelligence(id);
    // Whether the property file has moved on since the read was produced is
    // answered by comparing fingerprints — no model, no research, one SELECT.
    const source = acquisitionPropertyFile(id);
    const dossier = source ? buildAcquisitionDossier(source) : null;
    const fingerprint = dossier ? acquisitionDossierFingerprint(dossier) : null;
    return c.json({
      acquisitionIntelligence: read,
      readiness: dossier
        ? {
          ...propertyFileIsSufficient(dossier),
          coverage: dossier.coverage,
          conflicts: dossier.conflicts,
          visualsAvailable: dossier.visuals.map((visual) => visual.key),
        }
        : null,
      stale: !!read && !!fingerprint && read.dossierFingerprint !== fingerprint,
      run: acquisitionIntelligenceRuns.get(id) ?? null,
      runtime: acquisitionAnalystRuntimeStatus(),
    });
  });


  app.post('/api/landos/deal-cards/:id/acquisition-intelligence/run', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const deal = getDealCard(id);
    if (!deal) return c.json({ error: 'deal card not found' }, 404);
    const canonical = resolveCanonicalSubjectState(id);
    const cardId = canonical.propertyCardId ?? subjectCardId(deal);
    const missing = unmetPrerequisites(canonical, capabilityPrerequisites(ACQUISITION_INTELLIGENCE_CAPABILITY_ID));
    if (!cardId || missing.length) return c.json({
      error: 'waiting_prerequisite', outcome: 'waiting_prerequisite',
      capabilityId: ACQUISITION_INTELLIGENCE_CAPABILITY_ID,
      unmetPrerequisites: cardId ? missing : ['parcel'],
      canonicalSubject: { propertyCardId: cardId, subjectResolved: canonical.subjectResolved, officiallyVerified: canonical.officiallyVerified, basis: canonical.basis },
    }, 409);
    // One run per Deal Card. A second press while one is in flight joins the
    // run already going rather than starting a competing read.
    const inFlight = acquisitionIntelligenceRuns.get(id);
    if (inFlight && !inFlight.error) {
      return c.json({ running: true, startedAt: inFlight.startedAt, runtime: acquisitionAnalystRuntimeStatus() }, 202);
    }
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const startedAt = new Date().toISOString();
    acquisitionIntelligenceRuns.set(id, { startedAt, error: null });

    // Deliberately not awaited: the operator polls the GET above.
    void (async () => {
      try {
        const result = await invokeRuntimeCapability({
          capabilityId: ACQUISITION_INTELLIGENCE_CAPABILITY_ID,
          caller: { type: 'deal_card', ref: `deal:${id}` },
          subject: {
            kind: 'canonical_property',
            entity: deal.entity as LandosEntity,
            propertyCardId: cardId,
            dealCardId: id,
          },
          // Always a refresh: this endpoint exists precisely to produce a NEW
          // read. Reuse is what the GET above is for.
          mode: 'refresh',
          parameters: {
            ...(str(body.provider) ? { provider: str(body.provider)! } : {}),
            ...(str(body.model) ? { model: str(body.model)! } : {}),
          },
          context: { surface: 'deal_card', section: 'acquisition_intelligence' },
        }, {
          readPropertyFile: acquisitionPropertyFile,
          analyst: createHermesAcquisitionAnalyst(),
        });
        // A run that produced no read must leave the reason behind rather than
        // simply stopping, or the section looks unchanged for no stated cause.
        const failure = result.status === 'SUCCEEDED'
          ? null
          : String((result.facts as { summary?: unknown } | undefined)?.summary ?? result.warnings[0] ?? 'The analyst did not produce a read.');
        acquisitionIntelligenceRuns.set(id, { startedAt, error: failure });
        if (!failure) acquisitionIntelligenceRuns.delete(id);
      } catch (error) {
        const detail = (error as Error)?.message?.split(/\r?\n/, 1)[0] ?? 'unknown';
        logger.error({ event: 'acquisition_intelligence_run_failed', dealCardId: id, msg: detail }, 'acquisition_intelligence_run_failed');
        acquisitionIntelligenceRuns.set(id, { startedAt, error: `Acquisition Intelligence run failed: ${detail}` });
      }
    })();

    return c.json({ running: true, startedAt, runtime: acquisitionAnalystRuntimeStatus() }, 202);
  });

  // ── The Intelligence Stack ──────────────────────────────────────────────
  //
  // Four intelligence products over one shared property file: Property,
  // Market + Area, Seller (honestly Unknown pre-contact) and the Deal Brain.
  // Same fire-and-poll shape as Acquisition Intelligence: the GET is a pure
  // SELECT plus fingerprint staleness; only the POST engages the analyst, in
  // ONE coordinated pass over whichever layers are actually stale.

  // SQLite owns run identity and publication authority. AbortControllers are
  // process-local transport handles only; refresh/rejoin reads the durable row.
  const intelligenceStackRunStore = new IntelligenceStackRunStore();
  const intelligenceStackControllers = new Map<string, AbortController>();
  const INTELLIGENCE_RUN_CEILING_MS = 20 * 60_000;
  intelligenceStackRunStore.reclaimAbandoned(INTELLIGENCE_RUN_CEILING_MS);
  /** Reject and abort transport rather than let a wedged executor retain authority. */
  const withIntelligenceRunCeiling = <T,>(work: Promise<T>, onTimeout: () => void): Promise<T> => {
    let timer: NodeJS.Timeout | null = null;
    const ceiling = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        onTimeout();
        reject(new Error(`Intelligence finalization exceeded ${INTELLIGENCE_RUN_CEILING_MS} ms.`));
      }, INTELLIGENCE_RUN_CEILING_MS);
      timer.unref?.();
    });
    return Promise.race([work, ceiling]).finally(() => { if (timer) clearTimeout(timer); }) as Promise<T>;
  };
  const dealBrainRuns = new Map<number, { startedAt: string; error: string | null }>();
  const intelligenceReconcileRuns = new Map<number, { startedAt: string; error: string | null }>();
  const acreageExtentRuns = new Map<number, { startedAt: string; error: string | null }>();

  const readPipelineStage = (dealCardId: number): string | null => {
    const row = getLandosDb().prepare(
      'SELECT pipeline_stage FROM landos_opportunity WHERE legacy_deal_card_id=? LIMIT 1',
    ).get(dealCardId) as { pipeline_stage?: string } | undefined;
    return row?.pipeline_stage ?? null;
  };

  const intelligenceStackReadDeps = {
    readPropertyFile: acquisitionPropertyFile,
    reconcileReadiness: reconcileResearchReadiness,
    readPipelineStage,
  };

  const currentDealBrainProjection = (
    dealCardId: number,
    dossier = (() => {
      const source = acquisitionPropertyFile(dealCardId);
      return source ? buildAcquisitionDossier(source) : null;
    })(),
  ) => projectCurrentDealBrainGuidance(listDealBrainGuidance(dealCardId), {
    acceptedCompCount: dossier?.valuation.acceptedCompCount ?? 0,
    supportedFmv: dossier?.valuation.fairMarketValue ?? null,
  });

  const produceDealBrainReply = async (input: {
    dealCardId: number;
    message: string;
    questionEntryId: number;
    staleReplyIds: number[];
  }): Promise<void> => {
    const source = acquisitionPropertyFile(input.dealCardId);
    if (!source) throw new Error('no canonical property file is available for this Deal Card');
    const dossier = buildAcquisitionDossier(source);
    const state = readIntelligenceStackState(input.dealCardId, intelligenceStackReadDeps);
    const current = currentDealBrainProjection(input.dealCardId, dossier);
    const thread = current.thread
      .filter((entry) => entry.id !== input.questionEntryId)
      .map((entry) => ({ role: entry.role, text: entry.text }));
    const analyst = createIntelligenceExecutor();
    const run = await analyst.run({
      dossier,
      judgmentPromptBuilder: () => dealBrainChatPrompt({
        dossier,
        deal: state.products.deal,
        quickFlip: state.quickFlip,
        thread,
        question: input.message,
      }),
    });
    const reply = run.raw.replace(/\s+/g, ' ').trim().slice(0, 2_000);
    if (!reply) throw new Error('the Deal Brain returned an empty reply');
    appendDealBrainGuidance(input.dealCardId, 'deal_brain', reply);
    // Retire only after a replacement has safely persisted. A failed refresh
    // keeps the old row for audit while the current-truth projection still
    // prevents its contradiction from reaching the operator.
    retireDealBrainReplies(input.dealCardId, input.staleReplyIds);
  };

  // Deal-scoped War Room opening context. Registered here because every
  // builder it reuses (property file, dossier, stack state, guidance) is a
  // closure of this route module. SELECT-only: the same reads the Deal Card
  // GET endpoints serve — a War Room turn must never start research, a model
  // pass, or a provider call.
  setDealWarRoomContextProvider((dealCardId) => {
    const deal = getDealCard(dealCardId);
    if (!deal) return null;
    const source = acquisitionPropertyFile(dealCardId);
    const dossier = source ? buildAcquisitionDossier(source) : null;
    const identity = dossier?.identity ?? null;
    const labelCore = identity?.displayAddress
      ?? [
        identity?.apn ? `APN ${identity.apn}` : null,
        [identity?.county, identity?.stateCode ?? identity?.state].filter(Boolean).join(', ') || null,
      ].filter(Boolean).join(' · ')
      ?? null;
    const dealTitle = ((deal as { title?: unknown }).title ?? null);
    const dealLabel = `${labelCore || (typeof dealTitle === 'string' && dealTitle ? dealTitle : 'Property identity pending')} · Deal ${dealCardId}`;

    const state = readIntelligenceStackState(dealCardId, intelligenceStackReadDeps);
    const guidance = currentDealBrainProjection(dealCardId, dossier).thread.slice(-6);
    const readOf = (product: unknown): string | null => {
      const read = (product as { read?: unknown } | null | undefined)?.read;
      return typeof read === 'string' && read.trim() ? read.trim() : null;
    };
    const sections: string[] = [];
    sections.push(`DEAL: ${dealLabel}`);
    if (state.phase) sections.push(`Deal phase: ${state.phase}`);
    if (state.sufficiency) sections.push(`Property file sufficiency: ${state.sufficiency.ok ? 'sufficient' : `insufficient — ${state.sufficiency.reason ?? 'unstated reason'}`}`);
    const propertyRead = readOf(state.products.property);
    const marketRead = readOf(state.products.market);
    const sellerRead = readOf(state.products.seller);
    const dealRead = readOf(state.products.deal);
    if (propertyRead) sections.push(`PROPERTY INTELLIGENCE (current read):\n${propertyRead}`);
    if (marketRead) sections.push(`MARKET INTELLIGENCE (current read):\n${marketRead}`);
    if (sellerRead) sections.push(`SELLER INTELLIGENCE (current read):\n${sellerRead}`);
    if (dealRead) sections.push(`DEAL INTELLIGENCE (current read):\n${dealRead}`);
    if (state.quickFlip) sections.push(`QUICK FLIP ECONOMICS:\n${JSON.stringify(state.quickFlip)}`);
    if (guidance.length > 0) {
      sections.push(`RECENT DEAL BRAIN GUIDANCE (operator guidance is input, never fact):\n${guidance.map((entry) => `- ${entry.role}: ${entry.text}`).join('\n')}`);
    }
    if (dossier) {
      // Same rule as the analyst's judgment prompt: image file paths are
      // stripped — a path in prose invites "I inspected the image" claims.
      const inline = { ...dossier, visuals: dossier.visuals.map(({ filePath: _filePath, ...visual }) => ({ ...visual, filePath: null })) };
      sections.push(`CANONICAL DEAL DOSSIER (bounded, source-labeled; carries its own conflicts, open questions and coverage):\n${JSON.stringify(inline)}`);
    } else {
      sections.push('No canonical property file is available for this deal yet; only the deal record exists.');
    }

    // Per-seat bounded context for the four Hermes specialist seats. Lazy —
    // only a seat turn pays the assembly — and SELECT-only like everything
    // else in this provider: it projects state already read above. Each seat
    // receives the SAME bounded dossier view its production intelligence run
    // uses, plus its own current product and honest staleness.
    const seatContext = (seatId: string): string | null => {
      if (!dossier || !state.phase || !state.dossierFingerprint) return null;
      const envelope = specialistContextEnvelopeForPhase(dossier, state.phase, {
        dealCardId,
        generatedAt: dossier.assembledAt,
        contextFingerprint: state.dossierFingerprint,
      });
      const productSection = (label: string, product: unknown): string => {
        const projected = retainedProductProjection(product);
        return projected
          ? `=== CURRENT ${label} INTELLIGENCE PRODUCT (persisted LandOS product, JSON) ===\n${JSON.stringify(projected)}\n=== END ${label} INTELLIGENCE PRODUCT ===`
          : `No current ${label.toLowerCase()} intelligence product exists yet.`;
      };
      const freshnessLine = (stale: boolean): string => stale
        ? 'FRESHNESS: your persisted read above is STALE — the evidence has changed since it was produced. Treat its conclusions as provisional and say your read predates the latest evidence.'
        : 'FRESHNESS: your persisted read above is CURRENT against the latest evidence fingerprint.';
      let body: string[];
      if (seatId === 'property') {
        body = [
          envelope,
          productSection('PROPERTY', state.products.property),
          freshnessLine(state.stale.property),
          `=== PROPERTY FILE (JSON — the same bounded view your intelligence runs receive) ===\n${JSON.stringify(propertyDossierView(dossier))}\n=== END PROPERTY FILE ===`,
        ];
      } else if (seatId === 'market') {
        body = [
          envelope,
          productSection('MARKET', state.products.market),
          freshnessLine(state.stale.market),
          state.quickFlip ? `=== QUICK FLIP ECONOMICS (LandOS CALCULATION — carry verbatim, never recompute) ===\n${JSON.stringify(state.quickFlip)}\n=== END CALCULATION ===` : '',
          `=== MARKET FILE (JSON — the same bounded view your intelligence runs receive) ===\n${JSON.stringify(marketDossierView(dossier))}\n=== END MARKET FILE ===`,
        ];
      } else if (seatId === 'seller') {
        body = [
          envelope,
          productSection('SELLER', state.products.seller),
          freshnessLine(state.stale.seller),
          `=== SELLER FILE (JSON — the same bounded view your intelligence runs receive) ===\n${JSON.stringify(sellerDossierView(dossier))}\n=== END SELLER FILE ===`,
        ];
      } else if (seatId === 'deal-brain') {
        body = [
          envelope,
          state.sufficiency ? `Property file sufficiency: ${state.sufficiency.ok ? 'sufficient' : `insufficient — ${state.sufficiency.reason ?? 'unstated reason'}`}` : '',
          productSection('PROPERTY', state.products.property),
          productSection('MARKET', state.products.market),
          productSection('SELLER', state.products.seller),
          productSection('DEAL', state.products.deal),
          freshnessLine(state.stale.deal),
          state.quickFlip ? `=== QUICK FLIP ECONOMICS (LandOS CALCULATION — carry verbatim, never recompute) ===\n${JSON.stringify(state.quickFlip)}\n=== END CALCULATION ===` : '',
          guidance.length > 0
            ? `RECENT DEAL BRAIN GUIDANCE (operator guidance is input, never fact):\n${guidance.map((entry) => `- ${entry.role}: ${entry.text}`).join('\n')}`
            : '',
        ];
      } else {
        return null;
      }
      return boundContextText(body.filter(Boolean).join('\n\n'));
    };

    return { dealCardId, dealLabel, contextText: boundContextText(sections.join('\n\n')), seatContext };
  });

  app.get('/api/landos/deal-cards/:id/intelligence', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    if (!getDealCard(id)) return c.json({ error: 'deal card not found' }, 404);
    // This GET previously assembled the complete Property file twice: once for
    // stack staleness and again for Deal Brain freshness. Reuse the exact same
    // SELECT-only source inside this request so both projections reason over
    // identical persisted truth without rebuilding comps, market research,
    // evidence, visuals and development history a second time.
    let retainedPropertyFile: AcquisitionPropertyFileSource | null | undefined;
    const readPropertyFileOnce = (dealCardId: number): AcquisitionPropertyFileSource | null => {
      if (dealCardId !== id) return acquisitionPropertyFile(dealCardId);
      if (retainedPropertyFile === undefined) retainedPropertyFile = acquisitionPropertyFile(dealCardId);
      return retainedPropertyFile;
    };
    const state = readIntelligenceStackState(id, {
      ...intelligenceStackReadDeps,
      readPropertyFile: readPropertyFileOnce,
    });
    // Historical products remain retained in derived-snapshot history, but a
    // stale product is not a current operator read and does not project onto
    // Overview while its evidence fingerprint is superseded.
    const operatorProducts = {
      property: state.stale.property ? null : state.products.property,
      market: state.stale.market ? null : state.products.market,
      seller: state.stale.seller ? null : state.products.seller,
      deal: state.stale.deal ? null : state.products.deal,
    };
    const dealBrainDossier = retainedPropertyFile ? buildAcquisitionDossier(retainedPropertyFile) : null;
    const dealBrain = currentDealBrainProjection(id, dealBrainDossier);
    // Reconciliation state is SELECT-only here: the persisted record, whether
    // a run is in flight, and which persisted conflicts the seam could act on.
    // Nothing on this GET (or any page load) ever invokes a capability.
    const reconcileEligible = operatorProducts.property
      ? derivePropertyCapabilityRequests(operatorProducts.property, id)
        .map((request) => ({
          conflictSubject: request.evidenceConflictRefs[0] ?? null,
          issueType: request.issueType,
          requestedCapability: request.requestedCapability,
        }))
      : [];
    const retainedReconciliation = readDerivedSnapshot<IntelligenceReconciliationRecord>(id, INTELLIGENCE_RECONCILIATION_SNAPSHOT_TYPE);
    return c.json({
      ...state,
      products: operatorProducts,
      // The persisted Deal Brain strategy assessments from the retained
      // current snapshot, served even while the stack marks the deal read
      // stale: the Napkin layer projects persisted strategy truth
      // deterministically and labels provenance, and a strategy-fit list does
      // not become untrue because later seller evidence superseded the read's
      // freshness fingerprint. `stale` carries that honesty to the client.
      persistedDealStrategies: state.products.deal
        ? {
          strategies: state.products.deal.strategies ?? [],
          bestCurrentStrategy: state.products.deal.bestCurrentStrategy ?? null,
          stale: state.stale.deal,
        }
        : null,
      guidance: dealBrain.thread,
      dealBrainFreshness: {
        staleReplyCount: dealBrain.staleReplies.length,
        staleReasons: dealBrain.staleReplies.map((entry) => entry.staleReason),
      },
      run: (() => {
        intelligenceStackRunStore.reclaimAbandoned(INTELLIGENCE_RUN_CEILING_MS);
        const latest = intelligenceStackRunStore.latest(id);
        return !latest || latest.status === 'complete' || latest.status === 'superseded'
          ? null
          : { runId: latest.runId, status: latest.status, startedAt: latest.startedAt, error: latest.error, progress: latest.progress };
      })(),
      dealBrainRun: dealBrainRuns.get(id) ?? null,
      reconciliation: projectCurrentIntelligenceReconciliation(retainedReconciliation, operatorProducts.property),
      reconcileRun: intelligenceReconcileRuns.get(id) ?? null,
      reconcileEligible,
      // Official acreage / parcel-extent reconciliation: SELECT-only here.
      acreageExtent: readAcreageExtentRecord(id),
      acreageExtentRun: acreageExtentRuns.get(id) ?? null,
      runtime: intelligenceExecutorRuntimeStatus(),
    });
  });

  app.post('/api/landos/deal-cards/:id/intelligence/run', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const deal = getDealCard(id);
    if (!deal) return c.json({ error: 'deal card not found' }, 404);
    intelligenceStackRunStore.reclaimAbandoned(INTELLIGENCE_RUN_CEILING_MS);
    const inFlight = intelligenceStackRunStore.active(id);
    if (inFlight) {
      return c.json({ running: true, startedAt: inFlight.startedAt, progress: inFlight.progress, runtime: intelligenceExecutorRuntimeStatus() }, 202);
    }
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const layerNames: IntelligenceLayerId[] = ['property', 'market', 'seller', 'deal'];
    const layers = Array.isArray(body.layers)
      ? body.layers.filter((value): value is IntelligenceLayerId => layerNames.includes(value as IntelligenceLayerId))
      : undefined;
    const startedAt = new Date().toISOString();
    const runId = `intel_${id}_${Date.now().toString(36)}`;
    const controller = new AbortController();
    intelligenceStackControllers.set(runId, controller);
    intelligenceStackRunStore.create({ runId, dealCardId: id, startedAt, progress: startRunProgress(runId, startedAt) });
    // Fold each reported transition into the ONE in-flight record the GET
    // already serves. A run that has since been superseded or abandoned never
    // writes back over its replacement.
    const onProgress = (event: Parameters<typeof applyRunEvent>[1]): void => {
      const entry = intelligenceStackRunStore.get(runId);
      if (!entry || !entry.authoritative) return;
      intelligenceStackRunStore.updateProgress(
        runId,
        id,
        applyRunEvent(entry.progress, event, new Date().toISOString()),
      );
    };
    const settle = (failure: string | null): void => {
      const entry = intelligenceStackRunStore.get(runId);
      if (!entry || !entry.authoritative) return;
      const progress = finishRunProgress(entry.progress, { error: failure }, new Date().toISOString());
      intelligenceStackRunStore.finish({
        runId, dealCardId: id, status: failure ? 'failed' : 'complete', progress, error: failure,
      });
    };

    void (async () => {
      try {
        const work = runIntelligenceStack({
          dealCardId: id,
          layers: layers?.length ? layers : undefined,
          force: body.force === true,
          requestedProvider: str(body.provider) ?? null,
          requestedModel: str(body.model) ?? null,
          runId,
          signal: controller.signal,
        }, {
          ...intelligenceStackReadDeps,
          analyst: createIntelligenceExecutor(),
          onProgress,
          isRunAuthoritative: (candidateRunId) => intelligenceStackRunStore.isAuthoritative(candidateRunId, id),
          // Bounded God's Eye View spatial investigation before the Property
          // specialist reasons — best-effort; failures degrade to warnings.
          investigateSpatial: (dealCardId, dossier) => investigatePropertyWithGev(dealCardId, dossier, {
            runId,
            signal: controller.signal,
            isRunAuthoritative: (candidateRunId) => intelligenceStackRunStore.isAuthoritative(candidateRunId, id),
          }),
          runBackfill: async (itemIds: string[]) => {
            const report = await runResearchReadinessBackfill(
              id,
              deal.entity as CapabilityEntity,
              { itemIds },
              {
                runtime: { runLandUseResearch: landUseResearchLane, runHistorySearch: propertyHistoryLane },
                runId,
                signal: controller.signal,
                isRunAuthoritative: (candidateRunId) => intelligenceStackRunStore.isAuthoritative(candidateRunId, id),
              },
            );
            return 'error' in report ? null : report.after;
          },
        });
        const result = await withIntelligenceRunCeiling(work, () => {
          const entry = intelligenceStackRunStore.get(runId);
          if (!entry?.authoritative) return;
          controller.abort();
          const failure = `Intelligence finalization exceeded ${INTELLIGENCE_RUN_CEILING_MS} ms.`;
          intelligenceStackRunStore.finish({
            runId,
            dealCardId: id,
            status: 'failed',
            progress: finishRunProgress(entry.progress, { error: failure }, new Date().toISOString()),
            error: failure,
          });
        });
        settle(result.outcome === 'produced' || result.outcome === 'reused' ? null : result.reason);
      } catch (error) {
        const detail = (error as Error)?.message?.split(/\r?\n/, 1)[0] ?? 'unknown';
        logger.error({ event: 'intelligence_stack_run_failed', dealCardId: id, msg: detail }, 'intelligence_stack_run_failed');
        settle(`Intelligence run failed: ${detail}`);
      } finally {
        intelligenceStackControllers.delete(runId);
      }
    })();

    return c.json({
      running: true,
      startedAt,
      progress: intelligenceStackRunStore.get(runId)?.progress ?? null,
      runtime: intelligenceExecutorRuntimeStatus(),
    }, 202);
  });

  app.post('/api/landos/deal-cards/:id/intelligence/cancel', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const active = intelligenceStackRunStore.active(id);
    if (!active) return c.json({ cancelled: false, run: null });
    // Revoke durable authority before signalling transport. Even if an external
    // process ignores cancellation and settles late, guarded evidence/read
    // writers can no longer publish on behalf of this run.
    const progress = cancelRunProgress(active.progress, new Date().toISOString());
    const cancelled = intelligenceStackRunStore.cancel(active.runId, id, progress);
    intelligenceStackControllers.get(active.runId)?.abort();
    return c.json({
      cancelled,
      run: { runId: active.runId, status: 'cancelled', startedAt: active.startedAt, error: progress.error, progress },
    });
  });

  // ── Bounded intelligence → capability → reconciliation (explicit only) ──
  //
  // The ONE path that lets an intelligence product's unresolved material
  // conflict drive a governed capability. Explicit operator action; page loads
  // and refreshes never reach it (every GET above is SELECT-only). Per run:
  // at most ONE allowlisted capability execution and ONE targeted re-read of
  // the requesting layer, then STOP — remaining uncertainty is persisted, not
  // chased.
  app.post('/api/landos/deal-cards/:id/intelligence/reconcile', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const deal = getDealCard(id);
    if (!deal) return c.json({ error: 'deal card not found' }, 404);
    const stackInFlight = intelligenceStackRunStore.active(id);
    if (stackInFlight) {
      return c.json({ error: 'An intelligence run is already in flight for this deal.' }, 409);
    }
    const inFlight = intelligenceReconcileRuns.get(id);
    if (inFlight && !inFlight.error) {
      return c.json({ running: true, startedAt: inFlight.startedAt }, 202);
    }
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const conflictSubject = str(body.conflictSubject) ?? null;
    const cardId = subjectCardId(deal);
    if (!cardId) return c.json({ error: 'this Deal Card has no canonical subject Property Card yet' }, 409);
    const startedAt = new Date().toISOString();
    intelligenceReconcileRuns.set(id, { startedAt, error: null });

    void (async () => {
      try {
        await runIntelligenceReconciliation({ dealCardId: id, conflictSubject }, {
          readPropertyProduct: () =>
            readDerivedSnapshot<PropertyIntelligenceProduct>(id, PROPERTY_INTELLIGENCE_PRODUCT_TYPE),
          validate: (request, openConflictSubjects) => validateIntelligenceCapabilityRequest(request, {
            dealCardId: id,
            openConflictSubjects,
            capabilityExists: (capabilityId) => runtimeCapability(capabilityId) != null,
            latestResult: (capabilityId) => new CapabilityInvocationStore().latestForProperty(cardId, id, capabilityId),
          }),
          invokeCapability: (request) => invokeRuntimeCapability(
            capabilityInvocationFor(request, { entity: deal.entity as 'LAND_ALLY' | 'TY_LAND_BIZ', propertyCardId: cardId }),
          ),
          // The targeted re-read: only the requesting layer is refreshed. The
          // stack's own dependency rule folds the dependent Deal synthesis into
          // the SAME single analyst pass; Market and Seller are reused, and no
          // readiness backfill runs here.
          rereadIntelligence: async () => {
            const result = await runIntelligenceStack({ dealCardId: id, layers: ['property'] }, {
              ...intelligenceStackReadDeps,
              analyst: createIntelligenceExecutor(),
            });
            if (result.outcome !== 'produced' && result.outcome !== 'reused') {
              throw new Error(result.reason ?? `re-read outcome ${result.outcome}`);
            }
            return { outcome: result.outcome, refreshedLayers: result.refreshedLayers };
          },
          persistRecord: (record) => {
            writeDerivedSnapshot({
              dealCardId: id,
              snapshotType: INTELLIGENCE_RECONCILIATION_SNAPSHOT_TYPE,
              payload: record,
              completeness: {
                status: record.status,
                executionCount: record.execution.executionCount,
                rereadCount: record.reread.rereadCount,
              },
              changeReason: `Bounded intelligence reconciliation: ${record.status} — ${record.statusReason}`.slice(0, 600),
              actor: 'intelligence-reconciliation',
              auditEvent: 'intelligence_reconciliation',
            });
          },
        });
        intelligenceReconcileRuns.delete(id);
      } catch (error) {
        const detail = (error as Error)?.message?.split(/\r?\n/, 1)[0] ?? 'unknown';
        logger.error({ event: 'intelligence_reconcile_failed', dealCardId: id, msg: detail }, 'intelligence_reconcile_failed');
        intelligenceReconcileRuns.set(id, { startedAt, error: `Reconciliation failed: ${detail}` });
      }
    })();

    return c.json({ running: true, startedAt }, 202);
  });

  // ── Official acreage / parcel-extent reconciliation (explicit only) ─────
  //
  // The bounded run that settles WHAT THE CURRENT PARCEL'S ACREAGE/EXTENT IS:
  // reuse the retained assessor record, one county-GIS parcel query, one
  // assessment-database parcel-family search (≤3 sibling detail reads), a
  // deterministic reconciliation, persistence with provenance, and — only when
  // stronger identity-verified official evidence establishes it — adoption of
  // the canonical acreage with acreage-dependent products marked stale (never
  // rerun). Page loads read the persisted snapshot via the GET above.
  app.post('/api/landos/deal-cards/:id/acreage-extent/reconcile', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const deal = getDealCard(id);
    if (!deal) return c.json({ error: 'deal card not found' }, 404);
    const inFlight = acreageExtentRuns.get(id);
    if (inFlight && !inFlight.error) {
      return c.json({ running: true, startedAt: inFlight.startedAt }, 202);
    }
    const startedAt = new Date().toISOString();
    acreageExtentRuns.set(id, { startedAt, error: null });

    void (async () => {
      try {
        const record = await runOfficialAcreageExtentReconciliation(id);
        if (record.refusalReason) {
          acreageExtentRuns.set(id, { startedAt, error: record.refusalReason });
        } else {
          acreageExtentRuns.delete(id);
        }
      } catch (error) {
        const detail = (error as Error)?.message?.split(/\r?\n/, 1)[0] ?? 'unknown';
        logger.error({ event: 'acreage_extent_reconcile_failed', dealCardId: id, msg: detail }, 'acreage_extent_reconcile_failed');
        acreageExtentRuns.set(id, { startedAt, error: `Acreage reconciliation failed: ${detail}` });
      }
    })();

    return c.json({ running: true, startedAt }, 202);
  });

  // ── Acreage-dependent stale-product resolution (explicit only) ──────────
  //
  // The bounded deterministic pass that RESOLVES the stale markers an
  // acreage/extent adoption raised: each product is classified against the
  // canonical acreage (recalculated / retained-compatible-basis / requires
  // targeted refresh / still stale) and the classification is persisted into
  // the retained acreage-extent record. SELECTs plus one derived-snapshot
  // update — no providers, no model calls, no rescaling. Synchronous.
  app.post('/api/landos/deal-cards/:id/acreage-extent/refresh-dependents', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    if (!getDealCard(id)) return c.json({ error: 'deal card not found' }, 404);
    try {
      const result = runAcreageDependentRefresh(id);
      if (result.outcome === 'refused') return c.json({ error: result.reason }, 409);
      return c.json({
        outcome: result.outcome,
        reason: result.reason,
        remainingStale: result.remainingStale,
        record: result.record,
        acreageExtent: readAcreageExtentRecord(id),
      });
    } catch (error) {
      const detail = (error as Error)?.message?.split(/\r?\n/, 1)[0] ?? 'unknown';
      logger.error({ event: 'acreage_dependent_refresh_failed', dealCardId: id, msg: detail }, 'acreage_dependent_refresh_failed');
      return c.json({ error: `Acreage-dependent resolution failed: ${detail}` }, 500);
    }
  });

  // ── Smart Intake supervisor ─────────────────────────────────────────────
  //
  // Free-form clarification on a deal whose run is already in progress or stuck.
  // The operator's words are stored as guidance, the REAL structured run state
  // is read back, and the model explains what happened and names which existing
  // steps should run. This never creates a lead and never restarts the pipeline:
  // `plan.steps` is a closed set of already-registered capabilities, and running
  // them stays an explicit operator action so nothing expensive fires from typing.
  // The conversation as it stands, with no model call and no work started.
  // Without this the Smart Intake thread existed only in component state, so a
  // refresh showed an empty conversation on a deal that had one — which reads
  // exactly like "it forgot", the failure the conversation exists to end.
  app.get('/api/landos/deal-cards/:id/smart-intake', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const deal = getDealCard(id);
    if (!deal) return c.json({ error: 'deal card not found' }, 404);
    const cardId = subjectCardId(deal) ?? null;
    const evidence = buildSupervisorEvidence(id, cardId, '');
    // Old conclusions are kept verbatim. Once the canonical identity is
    // accepted, a turn that concluded the parcel was unresolved is history and
    // is labeled by the shared supersession rule, so the current state reads as
    // current and the failed attempt reads as the record of an attempt. Only
    // turns superseded by a LATER turn are marked: the newest conclusion is
    // never labeled historical by its own predecessors.
    const canonical = resolveCanonicalIdentity(id);
    const rawThread = listDealBrainGuidance(id);
    const lastAssistantId = [...rawThread].reverse()
      .find((turn) => turn.role !== 'operator')?.id ?? null;
    const UNRESOLVED_CONCLUSION = /\bNEEDS_INPUT\b|\bUNRESOLVED\b|could not (?:confirm|verify|identify|resolve)|does not identify a specific parcel|no exact parcel-level source/i;
    const thread = rawThread.map((turn) => {
      if (turn.role === 'operator' || turn.id === lastAssistantId) return turn;
      if (!UNRESOLVED_CONCLUSION.test(String(turn.text ?? ''))) return turn;
      const { superseded, label } = supersessionLabel({ canonical, attemptStatus: 'unresolved' });
      return superseded ? { ...turn, superseded: true, supersededLabel: label } : turn;
    });
    return c.json({
      thread,
      state: {
        resolution: evidence.resolution,
        landPortal: evidence.landPortal,
        identityConfidence: evidence.smartIntake.confidence,
        artifacts: evidence.artifacts,
      },
      // The current identity and the current evidence read travel with the
      // conversation, so it answers from the retained documents on open.
      canonicalIdentity: {
        status: canonical.status, confirmed: canonical.confirmed,
        apn: canonical.apn, owner: canonical.owner, basis: canonical.basis,
      },
      evidenceInterpretation: interpretRetainedDealEvidenceSafely(id),
    });
  });

  app.post('/api/landos/deal-cards/:id/smart-intake', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const deal = getDealCard(id);
    if (!deal) return c.json({ error: 'deal card not found' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const message = str(body.message)?.trim() ?? '';
    if (!message) return c.json({ error: 'message required' }, 400);
    try {
      const result = await runSmartIntakeSupervisor({
        dealCardId: id,
        propertyCardId: subjectCardId(deal) ?? null,
        operatorText: message,
      });
      return c.json({
        plan: result.plan,
        // The evidence the explanation was built from, so the operator can see
        // the model was reading real state and not improvising.
        state: {
          resolution: result.evidence.resolution,
          landPortal: result.evidence.landPortal,
          identityConfidence: result.evidence.smartIntake.confidence,
          // What the operator has attached, so the conversation can show it
          // instead of the operator having to remember what they sent.
          artifacts: result.evidence.artifacts,
        },
        thread: listDealBrainGuidance(id),
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      logger.warn({ err, dealCardId: id }, 'smart_intake_supervisor_route_failed');
      return c.json({ error: `Smart Intake could not process that: ${detail}` }, 500);
    }
  });

  // ── Deal Brain conversation ─────────────────────────────────────────────
  //
  // "Ask LandOS about this deal." The operator's message is stored as
  // deal-specific GUIDANCE — never a canonical property fact — and the reply
  // is reasoned from the CURRENT deal file. Input-mode neutral on purpose so
  // dictation or live voice can feed the same seam later.

  app.get('/api/landos/deal-cards/:id/deal-brain', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    if (!getDealCard(id)) return c.json({ error: 'deal card not found' }, 404);
    const projection = currentDealBrainProjection(id);
    return c.json({
      thread: projection.thread,
      freshness: {
        staleReplyCount: projection.staleReplies.length,
        staleReasons: projection.staleReplies.map((entry) => entry.staleReason),
      },
      run: dealBrainRuns.get(id) ?? null,
    });
  });

  app.post('/api/landos/deal-cards/:id/deal-brain', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    if (!getDealCard(id)) return c.json({ error: 'deal card not found' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const message = str(body.message)?.trim();
    if (!message) return c.json({ error: 'message required' }, 400);
    const inFlight = dealBrainRuns.get(id);
    if (inFlight && !inFlight.error) {
      return c.json({ error: 'The Deal Brain is still answering the previous message.' }, 409);
    }
    const operatorEntry = appendDealBrainGuidance(id, 'operator', message);
    const staleReplyIds = currentDealBrainProjection(id).staleReplies.map((entry) => entry.id);
    const startedAt = new Date().toISOString();
    dealBrainRuns.set(id, { startedAt, error: null });

    void (async () => {
      try {
        await produceDealBrainReply({
          dealCardId: id,
          message,
          questionEntryId: operatorEntry.id,
          staleReplyIds,
        });
        dealBrainRuns.delete(id);
      } catch (error) {
        const detail = (error as Error)?.message?.split(/\r?\n/, 1)[0] ?? 'unknown';
        logger.error({ event: 'deal_brain_reply_failed', dealCardId: id, msg: detail }, 'deal_brain_reply_failed');
        dealBrainRuns.set(id, { startedAt, error: `The Deal Brain could not answer: ${detail}` });
      }
    })();

    return c.json({ thread: currentDealBrainProjection(id).thread, running: true }, 202);
  });

  // Refresh only a retained Deal Brain synthesis that current canonical truth
  // has superseded. This reuses persisted evidence and performs one model read;
  // it never invokes research, providers, readiness backfill, or capabilities.
  app.post('/api/landos/deal-cards/:id/deal-brain/refresh', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    if (!getDealCard(id)) return c.json({ error: 'deal card not found' }, 404);
    const inFlight = dealBrainRuns.get(id);
    if (inFlight && !inFlight.error) {
      return c.json({ error: 'The Deal Brain is still answering the previous message.' }, 409);
    }
    const entries = listDealBrainGuidance(id);
    const projection = currentDealBrainProjection(id);
    if (!projection.staleReplies.length) {
      return c.json({ outcome: 'current', thread: projection.thread, running: false });
    }
    const latestStale = projection.staleReplies[projection.staleReplies.length - 1];
    const question = entries.filter((entry) => entry.role === 'operator' && entry.id < latestStale.id).at(-1);
    if (!question) return c.json({ error: 'No retained operator question exists for the stale synthesis.' }, 409);
    const startedAt = new Date().toISOString();
    dealBrainRuns.set(id, { startedAt, error: null });
    void (async () => {
      try {
        await produceDealBrainReply({
          dealCardId: id,
          message: question.text,
          questionEntryId: question.id,
          staleReplyIds: projection.staleReplies.map((entry) => entry.id),
        });
        dealBrainRuns.delete(id);
      } catch (error) {
        const detail = (error as Error)?.message?.split(/\r?\n/, 1)[0] ?? 'unknown';
        logger.error({ event: 'deal_brain_refresh_failed', dealCardId: id, msg: detail }, 'deal_brain_refresh_failed');
        dealBrainRuns.set(id, { startedAt, error: `The Deal Brain could not refresh: ${detail}` });
      }
    })();
    return c.json({ outcome: 'refreshing', thread: projection.thread, running: true }, 202);
  });

  // Land use, zoning and by-right subdivision projection alone, for refresh
  // without re-reading the whole property-intelligence record. SELECT-only.
  app.get('/api/landos/deal-cards/:id/land-use', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    if (!getDealCard(id)) return c.json({ error: 'deal card not found' }, 404);
    const propertyIntelligence = propertyIntelligenceView(id);
    return c.json({
      landUse: propertyIntelligence.landUse,
      landUseIntelligence: propertyIntelligence.landUseIntelligence,
      canonicalState: propertyIntelligence.canonicalState,
      subjectListing: propertyIntelligence.subjectListing,
      landPortalFacts: propertyIntelligence.landPortalFacts,
      access: propertyIntelligence.access,
      streetView: propertyIntelligence.streetView,
      marketContext: marketContextFor(getDealCard(id)!),
    });
  });

  /**
   * The live land-use research lane, as ONE function.
   *
   * It is the same nationwide engine the Deal Card has always run: jurisdiction
   * resolution, early web search to LOCATE the authoritative government source,
   * bounded official retrieval, rule extraction and the deterministic yield.
   * The Zoning & Subdivision Capability INJECTS this rather than importing it,
   * because the search transport and the government HTTP reader belong to the
   * route layer; the capability owns the invocation, not the network.
   *
   * Seller-supplied screening facts stay exactly what they were: SELLER-
   * REPORTED inputs to physical plausibility and discovery questions. None of
   * them becomes a legal conclusion.
   */
  async function landUseResearchLane(
    input: {
      propertyCardId: number;
      dealCardId: number;
      knowledgePlan: import('./knowledge-contract.js').KnowledgeResearchPlan | null;
      jurisdictionSubjectKeys: string[];
      parcelZoningRequired: boolean;
    },
    supplied: {
      hasImprovements?: unknown; hasExistingWell?: unknown; hasExistingSeptic?: unknown;
      sellerDiscussedCarveoutAcres?: unknown;
    } = {},
  ): Promise<LandUseResearchOutcome> {
    const deal = getDealCard(input.dealCardId);
    const card = getPropertyCard(input.propertyCardId);
    if (!deal || !card) {
      return { ran: false, lanes: [], summary: 'The Deal Card has no canonical subject Property Card, so no land-use research ran.' };
    }
    const notes = String(deal.seller_notes ?? '');
    const bool = (value: unknown, fallbackPattern: RegExp): boolean =>
      typeof value === 'boolean' ? value : fallbackPattern.test(notes);
    const carveout = typeof supplied.sellerDiscussedCarveoutAcres === 'number' && supplied.sellerDiscussedCarveoutAcres > 0
      ? supplied.sellerDiscussedCarveoutAcres
      : null;

    // ── CURRENT ZONING RESOLUTION ORDER ──────────────────────────────────
    //
    // A retained current-zoning result is reused ONLY when it is already
    // established from an official, parcel-specific source — never merely
    // because SOME retained material (a historical planning packet, a
    // subdivision-regulations PDF) exists for the parcel. Otherwise, before
    // the nationwide engine below runs its own handoff-only zoning read, the
    // SAME post-resolution authority, current-zoning and subdivision lanes
    // New Lead already runs are refreshed here: a focused web search for the
    // official zoning map/GIS/Planning-and-Zoning page, with the existing
    // browser-escalation lane for an interactive GIS map. Bounded by the same
    // budgets those lanes already carry; nothing here searches indefinitely.
    const zoningRefreshLanes: Array<{ lane: string; status: string; durationMs: number }> = [];
    const overrides = {
      apn: card.apn || null,
      address: card.active_input_address || null,
      city: card.city || null,
      county: card.county || null,
      state: card.state || null,
    };
    let refreshedAuthority = readControllingAuthority(input.dealCardId);
    let refreshedZoning = readCurrentZoning(input.dealCardId);
    if (input.parcelZoningRequired) {
      const zoningStartedAt = Date.now();
      try {
        const { authority, zoning } = await runLandUseAuthorityAndZoningForDeal(input.dealCardId, overrides);
        refreshedAuthority = authority;
        refreshedZoning = zoning;
        zoningRefreshLanes.push({
          lane: 'current_zoning_refresh',
          status: zoning.established ? 'complete' : 'partial',
          durationMs: Date.now() - zoningStartedAt,
        });
      } catch {
        zoningRefreshLanes.push({ lane: 'current_zoning_refresh', status: 'unreachable', durationMs: Date.now() - zoningStartedAt });
      }
    }

    if (input.jurisdictionSubjectKeys.length > 0) {
      const subdivisionStartedAt = Date.now();
      try {
        await runSubdivisionIntelligenceForDeal(input.dealCardId, overrides, {
          authority: refreshedAuthority,
          zoning: refreshedZoning,
          backstory: readPropertyBackstory(input.dealCardId),
          knowledgeSubjectKeys: input.jurisdictionSubjectKeys,
        });
        zoningRefreshLanes.push({ lane: 'subdivision_refresh', status: 'complete', durationMs: Date.now() - subdivisionStartedAt });
      } catch {
        zoningRefreshLanes.push({ lane: 'subdivision_refresh', status: 'unreachable', durationMs: Date.now() - subdivisionStartedAt });
      }
    }

    // Compatibility for a jurisdiction that cannot yet produce a knowledge
    // plan. Once a plan exists, the focused authority/zoning and subdivision
    // adapters above are the only released provider lanes.
    const run = input.knowledgePlan ? null : await runLandUseResearch({
      dealCardId: input.dealCardId,
      address: card.active_input_address || null,
      city: card.city || null,
      county: card.county || null,
      state: card.state || null,
      acres: typeof card.acres === 'number' ? card.acres : null,
      apn: card.apn || null,
      latitude: typeof card.lat === 'number' ? card.lat : null,
      longitude: typeof card.lng === 'number' ? card.lng : null,
      hasImprovements: bool(supplied.hasImprovements, /\b(house|home|residence|dwelling|improved|barn|structure|mobile home)\b/i),
      hasExistingWell: bool(supplied.hasExistingWell, /\bwell\b/i),
      hasExistingSeptic: bool(supplied.hasExistingSeptic, /\bseptic\b/i),
      sellerReported: notes.trim() ? [notes.trim().slice(0, 600)] : [],
      sellerDiscussedCarveoutAcres: carveout,
      // The first line of the operator's own lead text, used only to let the
      // federal geography lookup resolve a record whose structured city and
      // state were never filled in.
      addressHint: notes.split(/[\r\n]+/).map((line) => line.trim())
        .find((line) => line.includes(',') && /[a-z]{3}/i.test(line)) ?? null,
    });
    const lanes = [
      ...zoningRefreshLanes,
      ...(run?.lanes ?? []).map((lane) => ({ lane: lane.lane, status: lane.status, durationMs: lane.durationMs })),
    ];
    return {
      ran: lanes.length > 0,
      lanes,
      summary: lanes.length
        ? `Land-use research ran ${lanes.length} lane(s); ${lanes.filter((lane) => lane.status === 'complete').length} completed.`
        : 'Current compiled jurisdiction knowledge satisfied every expected subject; no provider lane ran.',
    };
  }

  /**
   * The bounded Property Development History lane.
   *
   * It IS the accepted Property Backstory lane, wired to its live transports by
   * `livePropertyBackstoryCapability()`. Retained document intelligence is read
   * inside it before anything is fetched, and its budget is the bound; nothing
   * here widens the search because a result was not found.
   */
  async function propertyHistoryLane(input: { propertyCardId: number; dealCardId: number }) {
    return runPropertyBackstoryForDeal(input.dealCardId);
  }

  // Run the nationwide land-use lane for one deal. Operator-initiated, like the
  // parcel lane: opening a Deal Card must never start legal research on its own.
  //
  // The research itself is unchanged; what changed is WHO invokes it. This
  // compatibility URL now executes INSIDE the Zoning & Subdivision Capability,
  // so no active caller keeps its own authoritative land-use execution path.
  app.post('/api/landos/deal-cards/:id/land-use/run', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const subject = dealCardAssessorTaxSubject(id, ZONING_SUBDIVISION_CAPABILITY_ID);
    if ('error' in subject) return c.json(subject, subject.status);
    const { deal, cardId } = subject;
    if (!getPropertyCard(cardId)) return c.json({ error: 'deal card has no subject property card' }, 409);

    // Subject facts an operator can supply. They are SELLER-REPORTED and are
    // used to screen physical plausibility and to generate discovery questions.
    // Nothing here ever becomes a legal conclusion.
    const body = await c.req.json().catch(() => ({})) as {
      hasImprovements?: unknown; hasExistingWell?: unknown; hasExistingSeptic?: unknown;
      sellerDiscussedCarveoutAcres?: unknown;
    };

    try {
      let executed: LandUseResearchOutcome | null = null;
      const result = await invokeRuntimeCapability({
        capabilityId: ZONING_SUBDIVISION_CAPABILITY_ID,
        caller: { type: 'deal_card', ref: `deal:${id}` },
        subject: { kind: 'canonical_property', entity: deal.entity as LandosEntity, propertyCardId: cardId, dealCardId: id },
        mode: 'refresh',
        parameters: { lane: 'research' },
        context: { surface: 'deal_card', dealCardId: id },
      }, {
        runLandUseResearch: async (input) => {
          executed = await landUseResearchLane(input, body);
          return executed;
        },
      });
      if (!executed) {
        return c.json({
          error: 'land use research was not released for this subject',
          detail: result.warnings[0] ?? 'The Zoning & Subdivision Capability did not release the research lane.',
        }, 409);
      }
      return c.json({
        landUse: buildLandUseView(id),
        landUseIntelligence: buildRetainedLandUseIntelligenceView(id),
        lanes: (executed as LandUseResearchOutcome).lanes,
        capability: ZONING_SUBDIVISION_CAPABILITY_ID,
        result,
      });
    } catch (err) {
      logger.error({ event: 'land_use_run_failed', dealCardId: id, msg: (err as Error)?.message }, 'land_use_run_failed');
      return c.json({ error: 'land use research failed', detail: (err as Error)?.message ?? 'unknown' }, 502);
    }
  });

  // Platform capability registry (PART 14). Designed capability and what a live
  // run actually proved are reported SEPARATELY so support is never claimed
  // without a real deployment behind it. Not property-scoped.
  app.get('/api/landos/gis-platforms', (c) => {
    return c.json({ platforms: buildPlatformCapabilityReport(listPlatformProofs()) });
  });

  // Comps & Valuation workspace projection alone (post-selection refresh
  // without re-reading the whole property-intelligence record). SELECT-only.
  app.get('/api/landos/deal-cards/:id/comps-valuation', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const view = buildCompsValuationView(id);
    if (!view) return c.json({ error: 'deal card not found' }, 404);
    const deal = getDealCard(id)!;
    const cardId = subjectCardId(deal);
    const propertyIntelligence = propertyIntelligenceView(id);
    return c.json({
      compsValuation: view,
      canonicalState: propertyIntelligence.canonicalState,
      subjectListing: cardId ? loadSubjectListingDetail(cardId) : null,
      landPortalFacts: propertyIntelligence.landPortalFacts,
      access: propertyIntelligence.access,
      streetView: propertyIntelligence.streetView,
      marketContext: marketContextFor(deal),
    });
  });
  // Read-only provider-page revisit followed by identity-gated local enrichment.
  // This never runs a marketplace search and never changes comp classification or valuation selection.
  app.post('/api/landos/deal-cards/:id/comps-valuation/enrich-listings', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    if (!getDealCard(id)) return c.json({ error: 'deal card not found' }, 404);
    const results = await enrichRetainedCompListings(id);
    return c.json({ results, compsValuation: buildCompsValuationView(id) });
  });

  // Transaction enrichment for comparables LandOS ALREADY retained.
  //
  // Marketplace SOLD result cards state a price but frequently no sale date,
  // and the price they state is often the last asking price rather than the
  // one the deal closed at. This revisits a bounded set of the strongest
  // already-retained candidates at their OWN retained URLs and writes back the
  // closed-sale facts those pages publish about themselves. It runs no search,
  // adds no comparable, and never changes classification or valuation
  // selection — the existing acreage-band and recency rules decide what the
  // corrected facts qualify for.
  app.post('/api/landos/deal-cards/:id/comps-valuation/enrich-transactions', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const deal = getDealCard(id);
    if (!deal) return c.json({ error: 'deal card not found' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const requested = num(body.limit);
    const limit = requested != null && requested > 0 ? Math.min(Math.floor(requested), 12) : 8;
    const cardId = subjectCardId(deal);
    const subject = cardId ? getPropertyCard(cardId) : undefined;
    const subjectAcres = typeof subject?.acres === 'number' ? subject.acres : null;
    const results = await enrichCompTransactions(id, { limit, subjectAcres });
    return c.json({
      results,
      enrichedCount: results.filter((r) => r.enriched).length,
      compsValuation: buildCompsValuationView(id),
    });
  });

  // Geographic reconciliation for comparables LandOS ALREADY retained.
  //
  // Discovery stays permissive; this is the discipline applied after it. Every
  // retained record's city, ZIP, coordinate and distance from the subject are
  // established from the evidence the record itself carries, then the
  // local / expanded / broader / unresolved tier that measurement earns is
  // persisted. It searches no marketplace, adds no comparable, revisits no
  // provider listing page, and deletes nothing: weak geography lowers a
  // record's weight and is stated on its card, never removes it.
  app.post('/api/landos/deal-cards/:id/comps-valuation/reconcile-geography', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    if (!getDealCard(id)) return c.json({ error: 'deal card not found' }, 404);
    const reconciliation = await reconcileCompGeography(id);
    return c.json({
      reconciliation,
      compsValuation: buildCompsValuationView(id),
    });
  });

  // Operator valuation-comp selection: include / exclude (with reason) /
  // restore an ELIGIBLE closed vacant-land sale. Preserves the record and the
  // reason; never deletes evidence; recalculates immediately.
  app.post('/api/landos/deal-cards/:id/comps-valuation/selection', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    if (!getDealCard(id)) return c.json({ error: 'deal card not found' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const compId = num(body.compId);
    const action = str(body.action) as CompSelectionAction | undefined;
    if (compId == null || !Number.isInteger(compId)) return c.json({ error: 'compId required' }, 400);
    if (action !== 'include' && action !== 'exclude' && action !== 'restore') {
      return c.json({ error: "action must be 'include', 'exclude', or 'restore'" }, 400);
    }
    const result = setCompValuationSelection({
      dealCardId: id,
      compId,
      action,
      reason: str(body.reason),
      actor: str(body.actor) ?? 'tyler/manual',
    });
    if (!result.ok) return c.json({ error: result.error ?? 'selection rejected' }, 400);
    return c.json({ compsValuation: buildCompsValuationView(id) });
  });

  // Bounded location resolution for the Comps & Valuation workspace: fill-only
  // subject geocode, persisted-comp enrichment (existing comp-map path), and
  // research-evidence addresses into the shared geocode cache. Free verified
  // geocoders only — never county GIS, never a guessed point.
  app.post('/api/landos/deal-cards/:id/comps-valuation/resolve-locations', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const result = await resolveCompsValuationLocations(id);
    if (!result) return c.json({ error: 'deal card not found' }, 404);
    landosAudit('landos/comps-valuation', 'comp_locations_resolved',
      `deal ${id}: subject ${result.subjectResolved ? 'resolved' : 'unresolved'}; ${result.compsEnriched} comp location(s) enriched; ${result.evidenceResolved} evidence listing(s) resolved; ${result.unresolved} unresolved`,
      { refTable: 'landos_deal_card', refId: id });
    return c.json({ resolution: result, compsValuation: buildCompsValuationView(id) });
  });

  // Progress-only read for polling while a mission runs.
  app.get('/api/landos/deal-cards/:id/property-resolution', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const deal = getDealCard(id);
    if (!deal) return c.json({ error: 'deal card not found' }, 404);
    const cardId = subjectCardId(deal);
    if (!cardId) return c.json({ capability: PROPERTY_RESOLUTION_CAPABILITY_ID, result: null, error: 'canonical subject Property Card is missing' }, 409);
    return c.json({
      capability: PROPERTY_RESOLUTION_CAPABILITY_ID,
      propertyCardId: cardId,
      result: new CapabilityInvocationStore().latestForProperty(cardId, id),
    });
  });

  app.post('/api/landos/deal-cards/:id/property-resolution/run', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const deal = getDealCard(id);
    if (!deal) return c.json({ error: 'deal card not found' }, 404);
    const terminal = terminalParcelStatus(deal);
    if (terminal) return c.json(terminalParcelError(terminal), 409);
    const cardIdBeforeRun = subjectCardId(deal);
    const activeMission = missionGraphStore.activeMission(DEAL_INTELLIGENCE_KIND, DEAL_INTELLIGENCE_SCOPE, id);
    const activeRun = propertyIntelligenceStore.activeRun(id);
    if (activeMission || activeRun) {
      return c.json({
        capability: PROPERTY_RESOLUTION_CAPABILITY_ID,
        reusedActiveRun: true,
        active: {
          missionId: activeMission?.missionId ?? null,
          runId: activeRun?.runId ?? activeMission?.missionId ?? null,
        },
        result: cardIdBeforeRun ? new CapabilityInvocationStore().latestForProperty(cardIdBeforeRun, id) : null,
      }, 202);
    }
    const runId = `property-resolution-${id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const capabilityStore = new CapabilityInvocationStore();
    const lockSubject = `deal:${id}`;
    const lock = capabilityStore.acquireExecutionLock(PROPERTY_RESOLUTION_CAPABILITY_ID, lockSubject, runId);
    if (!lock.acquired) {
      return c.json({
        capability: PROPERTY_RESOLUTION_CAPABILITY_ID,
        reusedActiveRun: true,
        active: { missionId: null, runId: lock.ownerId },
        result: cardIdBeforeRun ? capabilityStore.latestForProperty(cardIdBeforeRun, id) : null,
      }, 202);
    }
    try {
      await adoptAutomationControlPage();
      const outcome = await propertyIntelligenceCollectors(id, 'deal_card', 'refresh').parcel_identity({
        dealCardId: id,
        runId,
        identity: null,
        comparables: null,
      });
      const cardId = subjectCardId(getDealCard(id));
      const result = cardId ? capabilityStore.latestForProperty(cardId, id) : null;
      return c.json({ capability: PROPERTY_RESOLUTION_CAPABILITY_ID, outcome: { status: outcome.status, summary: outcome.summary }, result });
    } finally {
      capabilityStore.releaseExecutionLock(PROPERTY_RESOLUTION_CAPABILITY_ID, lockSubject, runId);
    }
  });

  // Deal Card → Assessor & Tax. The subject is the Deal Card's existing
  // canonical Property Card; the capability reads it and never replaces it, so
  // a rerun can refresh the assessor record without touching property identity.
  const dealCardAssessorTaxSubject = (id: number, capabilityId?: string) => {
    const deal = getDealCard(id);
    if (!deal) return { error: 'deal card not found' as const, status: 404 as const };
    const canonical = resolveCanonicalSubjectState(id);
    const cardId = canonical.propertyCardId ?? subjectCardId(deal);
    if (!cardId) return { error: 'this Deal Card has no canonical subject Property Card yet' as const, status: 409 as const };
    if (capabilityId) {
      const missing = unmetPrerequisites(canonical, capabilityPrerequisites(capabilityId));
      if (missing.length) {
        return {
          error: 'waiting_prerequisite' as const,
          status: 409 as const,
          outcome: 'waiting_prerequisite' as const,
          capabilityId,
          unmetPrerequisites: missing,
          canonicalSubject: {
            propertyCardId: cardId,
            subjectResolved: canonical.subjectResolved,
            officiallyVerified: canonical.officiallyVerified,
            basis: canonical.basis,
          },
        };
      }
    }
    return { deal, cardId };
  };

  // Deal Card → Utility Availability Resolution.
  //
  // READ ONLY, and deliberately so. The retained record holds OBSERVATIONS; the
  // six-dimension read is derived from them by pure functions on every request.
  // That is what makes a hard refresh free: this route opens no browser, calls
  // no model, contacts no provider and re-runs no research. It also means the
  // promotion guards apply to old records, not just new ones.
  app.get('/api/landos/deal-cards/:id/utility-availability', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const subject = dealCardAssessorTaxSubject(id);
    if ('error' in subject) return c.json({ error: subject.error }, subject.status);
    const record = loadUtilityAvailabilityRecord(subject.cardId);
    if (!record) {
      return c.json({ dealCardId: id, propertyCardId: subject.cardId, availability: null });
    }
    const resolver = readResolverSubject(id);
    const availability = projectUtilityAvailability(record, {
      address: resolver?.address ?? null,
      apn: resolver?.apn ?? null,
      county: resolver?.county ?? null,
      state: resolver?.state ?? null,
      acres: resolver?.acres ?? null,
      contemplatedUse: null,
    });
    // The retained record holds a filesystem path; the page needs a URL, and
    // the operator's browser needs never to see the former. Swapped here rather
    // than in the projection, because where a capture is SERVED from is a
    // transport concern and the projection stays pure.
    for (const kind of ['water', 'sewer'] as const) {
      const infrastructure = availability[kind].infrastructure;
      infrastructure.screenshotPath = infrastructure.screenshotPath
        ? `/api/landos/deal-cards/${id}/utility-availability/map/${kind}`
        : null;
    }
    return c.json({ dealCardId: id, propertyCardId: subject.cardId, availability });
  });

  app.get('/api/landos/deal-cards/:id/assessor-tax', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const subject = dealCardAssessorTaxSubject(id);
    if ('error' in subject) return c.json({ error: subject.error }, subject.status);
    return c.json({
      capability: ASSESSOR_TAX_CAPABILITY_ID,
      propertyCardId: subject.cardId,
      result: new CapabilityInvocationStore().latestForProperty(subject.cardId, id, ASSESSOR_TAX_CAPABILITY_ID),
    });
  });

  app.post('/api/landos/deal-cards/:id/assessor-tax', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const subject = dealCardAssessorTaxSubject(id, ASSESSOR_TAX_CAPABILITY_ID);
    if ('error' in subject) return c.json(subject, subject.status);
    try {
      const result = await invokeRuntimeCapability({
        capabilityId: ASSESSOR_TAX_CAPABILITY_ID,
        caller: { type: 'deal_card', ref: `deal:${id}` },
        subject: {
          kind: 'canonical_property',
          entity: subject.deal.entity as LandosEntity,
          propertyCardId: subject.cardId,
          dealCardId: id,
        },
        mode: body.refresh === false ? 'reuse' : 'refresh',
        context: { surface: 'deal_card', dealCardId: id },
      });
      return c.json({ capability: ASSESSOR_TAX_CAPABILITY_ID, propertyCardId: subject.cardId, result });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  // Deal Card → LandPortal Research. The subject is this card's existing
  // canonical Property Card; the capability reads it and never replaces it, so
  // a rerun can refresh the LandPortal record without touching property
  // identity. It is the SAME capability Tools and New Lead invoke.
  app.get('/api/landos/deal-cards/:id/landportal-research', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const subject = dealCardAssessorTaxSubject(id);
    if ('error' in subject) return c.json({ error: subject.error }, subject.status);
    return c.json({
      capability: LANDPORTAL_RESEARCH_CAPABILITY_ID,
      propertyCardId: subject.cardId,
      result: new CapabilityInvocationStore().latestForProperty(subject.cardId, id, LANDPORTAL_RESEARCH_CAPABILITY_ID),
    });
  });

  app.post('/api/landos/deal-cards/:id/landportal-research', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const subject = dealCardAssessorTaxSubject(id, LANDPORTAL_RESEARCH_CAPABILITY_ID);
    if ('error' in subject) return c.json(subject, subject.status);
    try {
      const result = await invokeRuntimeCapability({
        capabilityId: LANDPORTAL_RESEARCH_CAPABILITY_ID,
        caller: { type: 'deal_card', ref: `deal:${id}` },
        subject: {
          kind: 'canonical_property',
          entity: subject.deal.entity as LandosEntity,
          propertyCardId: subject.cardId,
          dealCardId: id,
        },
        mode: body.refresh === false ? 'reuse' : 'refresh',
        parameters: { lane: 'parcel_facts' },
        context: { surface: 'deal_card', dealCardId: id },
      });
      return c.json({ capability: LANDPORTAL_RESEARCH_CAPABILITY_ID, propertyCardId: subject.cardId, result });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  // Deal Card → Comps & Valuation. The subject is this card's existing canonical
  // Property Card; the capability reads the comp and valuation evidence for that
  // parcel and never replaces it, so a rerun refreshes the result without
  // touching property identity. It is the SAME capability Tools and New Lead
  // invoke, over the same underlying comp-selection and valuation implementation.
  app.get('/api/landos/deal-cards/:id/comps-valuation/capability', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const subject = dealCardAssessorTaxSubject(id);
    if ('error' in subject) return c.json({ error: subject.error }, subject.status);
    return c.json({
      capability: COMPS_VALUATION_CAPABILITY_ID,
      propertyCardId: subject.cardId,
      result: new CapabilityInvocationStore().latestForProperty(subject.cardId, id, COMPS_VALUATION_CAPABILITY_ID),
    });
  });

  app.post('/api/landos/deal-cards/:id/comps-valuation/capability', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const subject = dealCardAssessorTaxSubject(id, COMPS_VALUATION_CAPABILITY_ID);
    if ('error' in subject) return c.json(subject, subject.status);
    try {
      const result = await invokeRuntimeCapability({
        capabilityId: COMPS_VALUATION_CAPABILITY_ID,
        caller: { type: 'deal_card', ref: `deal:${id}` },
        subject: {
          kind: 'canonical_property',
          entity: subject.deal.entity as LandosEntity,
          propertyCardId: subject.cardId,
          dealCardId: id,
        },
        mode: body.refresh === false ? 'reuse' : 'refresh',
        parameters: { lane: 'retained_valuation' },
        context: { surface: 'deal_card', dealCardId: id },
      });
      return c.json({ capability: COMPS_VALUATION_CAPABILITY_ID, propertyCardId: subject.cardId, result });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  // Deal Card → Zoning & Subdivision. The subject is this card's existing
  // canonical Property Card; the capability reads the land-use rules for that
  // parcel's jurisdiction and applies them to it, and never replaces the
  // parcel, so a rerun refreshes the result without touching property identity.
  app.get('/api/landos/deal-cards/:id/zoning-subdivision/capability', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const subject = dealCardAssessorTaxSubject(id);
    if ('error' in subject) return c.json({ error: subject.error }, subject.status);
    const retained = new CapabilityInvocationStore().latestForProperty(subject.cardId, id, ZONING_SUBDIVISION_CAPABILITY_ID);
    return c.json({
      capability: ZONING_SUBDIVISION_CAPABILITY_ID,
      propertyCardId: subject.cardId,
      result: projectZoningSubdivisionWithCurrentTruth(retained, readCurrentZoning(id)),
    });
  });

  app.post('/api/landos/deal-cards/:id/zoning-subdivision/capability', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const subject = dealCardAssessorTaxSubject(id, ZONING_SUBDIVISION_CAPABILITY_ID);
    if ('error' in subject) return c.json(subject, subject.status);
    try {
      const result = await invokeRuntimeCapability({
        capabilityId: ZONING_SUBDIVISION_CAPABILITY_ID,
        caller: { type: 'deal_card', ref: `deal:${id}` },
        subject: {
          kind: 'canonical_property',
          entity: subject.deal.entity as LandosEntity,
          propertyCardId: subject.cardId,
          dealCardId: id,
        },
        mode: body.refresh === false ? 'reuse' : 'refresh',
        // A rerun from the card researches: when the jurisdiction's rules are
        // not already trusted, the lane searches early for the authoritative
        // government source rather than reporting "not established".
        parameters: { lane: body.research === false ? 'retained_rules' : 'research' },
        context: { surface: 'deal_card', dealCardId: id },
      }, { runLandUseResearch: landUseResearchLane });
      return c.json({ capability: ZONING_SUBDIVISION_CAPABILITY_ID, propertyCardId: subject.cardId, result });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  // Deal Card → Property Development History. Same canonical subject, different
  // business question. Retained context is consumed first; the additional
  // search is bounded and may honestly return no material history.
  app.get('/api/landos/deal-cards/:id/property-development-history/capability', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const subject = dealCardAssessorTaxSubject(id);
    if ('error' in subject) return c.json({ error: subject.error }, subject.status);
    return c.json({
      capability: PROPERTY_DEVELOPMENT_HISTORY_CAPABILITY_ID,
      propertyCardId: subject.cardId,
      result: new CapabilityInvocationStore().latestForProperty(subject.cardId, id, PROPERTY_DEVELOPMENT_HISTORY_CAPABILITY_ID),
    });
  });

  app.post('/api/landos/deal-cards/:id/property-development-history/capability', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const subject = dealCardAssessorTaxSubject(id, PROPERTY_DEVELOPMENT_HISTORY_CAPABILITY_ID);
    if ('error' in subject) return c.json(subject, subject.status);
    try {
      const result = await invokeRuntimeCapability({
        capabilityId: PROPERTY_DEVELOPMENT_HISTORY_CAPABILITY_ID,
        caller: { type: 'deal_card', ref: `deal:${id}` },
        subject: {
          kind: 'canonical_property',
          entity: subject.deal.entity as LandosEntity,
          propertyCardId: subject.cardId,
          dealCardId: id,
        },
        mode: body.refresh === false ? 'reuse' : 'refresh',
        parameters: { lane: body.research === false ? 'retained_history' : 'research' },
        context: { surface: 'deal_card', dealCardId: id },
      }, { runHistorySearch: propertyHistoryLane });
      return c.json({ capability: PROPERTY_DEVELOPMENT_HISTORY_CAPABILITY_ID, propertyCardId: subject.cardId, result });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  // ── Research Readiness Manifest ───────────────────────────────────────────
  //
  // ONE deterministic checklist per Deal Card: what research this property
  // should have, what ran, what returned usable evidence, what is honestly
  // unresolved, what is stale, and what needs a human.
  //
  // The GET is READ-ONLY and reconciles from retained state. Opening or
  // refreshing a Deal Card calls it and nothing else: no capability is invoked,
  // no model is called, no browser opens. Research happens only through the
  // explicit backfill POST below.
  // ── The research coverage cycle ───────────────────────────────────────────
  // Re-run Research is a control system, not a launcher: it inspects what the
  // Deal already has, attempts only the machine-owned gaps, confirms what
  // actually landed, and then lets the specialist layers reevaluate. The pieces
  // are all pre-existing — the readiness manifest, the bounded backfill, and
  // the intelligence stack — and this is the loop between them.
  const researchCoverageCycles = new Map<number, ResearchCoverageCycleResult>();

  const runDealCoverageCycle = async (
    id: number,
    entity: CapabilityEntity,
    trigger: 'automatic' | 'operator_rerun' = 'automatic',
    // What the Deal's own documents just established, when the cycle was
    // triggered by evidence. The cycle uses it to decide what NOT to retrieve:
    // a requirement a subject survey already answers is not a gap, and running
    // it anyway is exactly the wasted work an evidence trigger should prevent.
    evidence?: DealEvidenceInterpretation | null,
  ) => {
    // Requirement keys the interpreted subject evidence genuinely closed. Only
    // subject-parcel claims reach `satisfiedFields`, and a field with an open
    // contradiction is deliberately excluded upstream, so a contested fact
    // still counts as a gap. Frontage is intentionally absent from the mapping:
    // a survey showing road frontage is physical evidence and never by itself
    // establishes a recorded legal right of access.
    const EVIDENCE_SATISFIES: Record<string, string[]> = {
      acreage: ['acreage', 'parcel_acreage'],
      legalDescription: ['legal_description'],
      surveyBoundary: ['parcel_boundary'],
      floodZone: ['flood_zone'],
      owner: ['owner_of_record'],
    };
    const evidenceSatisfied = new Set(
      (evidence?.satisfiedFields ?? []).flatMap((field) => EVIDENCE_SATISFIES[field] ?? []),
    );
    // Coverage is an evidence-producing run in its own right. Give the entire
    // backfill -> recovery -> cascade chain one durable authority record so a
    // cancelled or superseded cycle cannot publish late specialist evidence.
    const startedAt = new Date().toISOString();
    const runId = `coverage_${id}_${Date.now().toString(36)}`;
    const controller = new AbortController();
    intelligenceStackRunStore.create({ runId, dealCardId: id, startedAt, progress: startRunProgress(runId, startedAt) });
    let failure: string | null = null;
    try {
      const result = await runResearchCoverageCycle({ dealCardId: id, entity, trigger }, {
      reconcile: (dealCardId) => {
        const manifest = reconcileResearchReadiness(dealCardId);
        return isReconcileError(manifest) ? { error: manifest.error } : manifest;
      },
      backfill: async (dealCardId, subjectEntity, itemIds, options) => {
        // The delta, narrowed by what the operator's own documents already
        // answered. Everything still missing goes to the same shared retrieval
        // orchestrator untouched — this only removes work the evidence made
        // unnecessary, it never adds a lane or a second engine.
        const remaining = evidenceSatisfied.size
          ? itemIds.filter((itemId) => !evidenceSatisfied.has(String(itemId)))
          : itemIds;
        if (evidenceSatisfied.size && remaining.length !== itemIds.length) {
          logger.info(
            { dealCardId, skipped: itemIds.length - remaining.length, satisfiedByEvidence: [...evidenceSatisfied] },
            'coverage_delta_narrowed_by_operator_evidence',
          );
        }
        const report = await runResearchReadinessBackfill(
          dealCardId,
          subjectEntity,
          { itemIds: remaining, includeStale: true, includeUnresolved: options?.includeUnresolved === true },
          {
            runtime: { runLandUseResearch: landUseResearchLane, runHistorySearch: propertyHistoryLane },
            runId,
            signal: controller.signal,
            isRunAuthoritative: (candidateRunId) => intelligenceStackRunStore.isAuthoritative(candidateRunId, id),
          },
        );
        return 'error' in report ? null : report.after;
      },
      // The existing specialist cascade. Property, Market, Seller and Deal
      // Brain each recompute only when the evidence they consume actually
      // moved, and each is expected to produce a useful current read from
      // incomplete-but-sufficient evidence rather than staying silent.
      cascade: async (dealCardId) => {
        const deal = getDealCard(dealCardId);
        const stackResult = await runIntelligenceStack({ dealCardId, runId, signal: controller.signal }, {
          ...intelligenceStackReadDeps,
          analyst: createIntelligenceExecutor(),
          isRunAuthoritative: (candidateRunId) => intelligenceStackRunStore.isAuthoritative(candidateRunId, id),
          investigateSpatial: (cardId, dossier) => investigatePropertyWithGev(cardId, dossier, {
            runId,
            signal: controller.signal,
            isRunAuthoritative: (candidateRunId) => intelligenceStackRunStore.isAuthoritative(candidateRunId, id),
          }),
          runBackfill: async (itemIds: string[]) => {
            if (!deal) return null;
            const report = await runResearchReadinessBackfill(
              dealCardId,
              deal.entity as CapabilityEntity,
              { itemIds },
              {
                runtime: { runLandUseResearch: landUseResearchLane, runHistorySearch: propertyHistoryLane },
                runId,
                signal: controller.signal,
                isRunAuthoritative: (candidateRunId) => intelligenceStackRunStore.isAuthoritative(candidateRunId, id),
              },
            );
            return 'error' in report ? null : report.after;
          },
        });
        return {
          outcome: stackResult.outcome,
          reason: stackResult.reason,
          refreshedLayers: stackResult.refreshedLayers,
          reusedLayers: stackResult.reusedLayers,
          warnings: stackResult.warnings,
        };
      },
      log: (event, detail) => logger.info(detail, event),
      });
      if ('error' in result) failure = result.error;
      else researchCoverageCycles.set(id, result);
      return result;
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      const entry = intelligenceStackRunStore.get(runId);
      if (entry?.authoritative) {
        intelligenceStackRunStore.finish({
          runId,
          dealCardId: id,
          status: failure ? 'failed' : 'complete',
          progress: finishRunProgress(entry.progress, { error: failure }, new Date().toISOString()),
          error: failure,
        });
      }
    }
  };

  app.get('/api/landos/deal-cards/:id/research-readiness', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const manifest = reconcileResearchReadiness(id);
    if (isReconcileError(manifest)) return c.json({ error: manifest.error }, manifest.status);
    // The same reconciled manifest, projected into the coverage vocabulary an
    // operator (and later MiniMax) reads: what is REUSED versus RETURNED, what
    // is PARTIAL because the lane executed without establishing its output, and
    // which specialist asked for each thing that is still missing. SELECT-only.
    const coverage = planResearchCoverage(manifest);
    return c.json({
      manifest,
      canonicalSubject: (() => {
        const subject = resolveCanonicalSubjectState(id);
        return {
          propertyCardId: subject.propertyCardId,
          subjectResolved: subject.subjectResolved,
          officiallyVerified: subject.officiallyVerified,
          basis: subject.basis,
        };
      })(),
      coverage,
      evidenceRequirements: specialistEvidenceRequirements(coverage, manifest),
      lastCycle: researchCoverageCycles.get(id) ?? null,
    });
  });

  // Targeted backfill. Bounded by the manifest: only red machine-resolvable
  // items (plus blue ones when explicitly asked for), one invocation per owning
  // capability. Green is never rerun, yellow never loops, gray never runs.
  app.post('/api/landos/deal-cards/:id/research-readiness/backfill', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const body = (await c.req.json().catch(() => ({}))) as { itemIds?: unknown; includeStale?: unknown };
    const subject = dealCardAssessorTaxSubject(id);
    if ('error' in subject) return c.json({ error: subject.error }, subject.status);
    const itemIds = Array.isArray(body.itemIds)
      ? body.itemIds.filter((value): value is string => typeof value === 'string' && !!researchReadinessItem(value))
      : undefined;
    const report = await runResearchReadinessBackfill(
      id,
      subject.deal.entity as CapabilityEntity,
      { itemIds, includeStale: body.includeStale === true },
      { runtime: { runLandUseResearch: landUseResearchLane, runHistorySearch: propertyHistoryLane } },
    );
    if ('error' in report) return c.json({ error: report.error }, report.status);
    return c.json(report);
  });

  app.get('/api/landos/deal-cards/:id/property-intelligence/progress', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    if (!getDealCard(id)) return c.json({ error: 'deal card not found' }, 404);
    const view = propertyIntelligenceProgressView(id);
    // The completion metric the operator reads, computed HERE so no surface can
    // invent its own. The panel used to count every settled lane — including
    // the ones that answered nothing and the one that was externally blocked —
    // and present the total as "12 of 12 lanes reported". Outcomes are counted
    // now, and only RETURNED is an answer.
    const laneOutcomes = tallyResearchLanes(
      (view.specialists ?? []).map((lane) => ({
        status: lane.status,
        failureCategory: lane.failureCategory ?? null,
      })),
    );
    return c.json({
      run: view.run,
      specialists: view.specialists,
      laneOutcomes,
      snapshotStatus: view.snapshotStatus,
      progressive: view.progressive,
    });
  });

  app.post('/api/landos/deal-cards/:id/property-intelligence/run', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const deal = getDealCard(id);
    if (!deal) return c.json({ error: 'deal card not found' }, 404);
    const terminal = terminalParcelStatus(deal);
    if (terminal) return c.json(terminalParcelError(terminal), 409);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const wait = body.wait === true;
    const fullRunId = `deal-intelligence-${id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fullRunCapabilityStore = new CapabilityInvocationStore();
    const fullRunLockSubject = `deal:${id}`;
    // A prior run that has already reached a terminal state is not competing
    // for this subject, so its abandoned lock must not refuse a fresh cycle.
    const runIsFinished = (ownerId: string): boolean => {
      const row = getLandosDb().prepare(
        `SELECT status FROM landos_mission WHERE mission_id = ? LIMIT 1`,
      ).get(ownerId) as { status?: string } | undefined;
      const status = String(row?.status ?? '').toLowerCase();
      if (status === '') return false;
      return !['running', 'queued', 'pending', 'in_progress', 'active'].includes(status);
    };
    const fullRunLock = fullRunCapabilityStore.acquireExecutionLock(PROPERTY_RESOLUTION_CAPABILITY_ID, fullRunLockSubject, fullRunId, runIsFinished);
    if (!fullRunLock.acquired) {
      return c.json({
        launch: { runId: fullRunLock.ownerId, missionId: fullRunLock.ownerId, dealCardId: id, alreadyRunning: true },
        reusedActiveRun: true,
        propertyIntelligence: propertyIntelligenceView(id),
      }, 202);
    }
    let fullRunLockHeld = true;
    const releaseFullRunLock = () => {
      if (!fullRunLockHeld) return;
      fullRunLockHeld = false;
      fullRunCapabilityStore.releaseExecutionLock(PROPERTY_RESOLUTION_CAPABILITY_ID, fullRunLockSubject, fullRunId);
    };
    try {

    // The capability root reconciles WHO the subject is before any dependent
    // research lane receives it. Intake remains evidence, never identity truth.
    // Identity reconciliation belongs to the Property Resolution Capability.
    // The root collector invokes its beforeResolve transition while holding the
    // shared subject lock; this route never mutates identity before the mission.

    // Know the control page BEFORE any lane can allocate a tab. A session that
    // is already connected does not re-adopt on its own, and the previous run's
    // reap may have minted a replacement since.
    await adoptAutomationControlPage();

    // The planned delta, BEFORE anything runs: which requirements this cycle
    // reuses, which it will attempt, and which nothing registered can close.
    // Logged so the run's own record shows what it intended, and returned so
    // the operator surface can show it without a second reconcile.
    const preManifest = reconcileResearchReadiness(id);
    const coveragePlan = isReconcileError(preManifest) ? null : planResearchCoverage(preManifest);
    if (coveragePlan) {
      logger.info({
        dealCardId: id,
        runId: fullRunId,
        headline: coveragePlan.headline,
        reuse: coveragePlan.reuseItemIds,
        run: coveragePlan.runItemIds,
        blocked: coveragePlan.entries.filter((entry) => entry.action === 'blocked').map((entry) => entry.id),
        notApplicable: coveragePlan.entries.filter((entry) => entry.action === 'not_applicable').map((entry) => entry.id),
      }, 'research_coverage_planned_delta');
    }

    // ONE operator action → ONE parent mission on the native mission graph.
    const { launch, completion } = launchDealIntelligenceMission({
      dealCardId: id,
      runIdFactory: () => fullRunId,
      trigger: str(body.actor) ?? 'operator',
      capabilities: dealIntelligenceCapabilities(id, 'deal_card', 'refresh'),
      missionStore: missionGraphStore,
      snapshotStore: propertyIntelligenceStore,
      // The operator's Chrome belongs to the operator: cleanup closes only the
      // pages this workflow opened and never the browser itself.
      browserCleanup: () => closeSurplusSessionPages(),
    });
    if (launch.alreadyRunning) {
      releaseFullRunLock();
      logger.info({ dealCardId: id, runId: launch.runId, missionId: launch.missionId }, 'deal_intelligence_already_running');
      return c.json({ launch, identityReconciliation: null, propertyIntelligence: propertyIntelligenceView(id) });
    }
    completion
      .then(async (snapshot) => {
        const cardId = subjectCardId(deal);
        if (!snapshot || !cardId || !googleVisualConfiguredResolved()) return;
        const capture = await captureAndPersistAcceptedIdentityVisuals({
          cardId,
          apn: snapshot.identity.apn,
          coordinates: snapshot.identity.coordinates,
          discoveryUsable: snapshot.identity.discoveryUsable === true,
          discoverySources: snapshot.identity.discoverySources ?? [],
        }, { env: resolveGoogleVisualEnv(), timeoutMs: 25_000 });
        logger.info({
          dealCardId: id,
          cardId,
          runId: launch.runId,
          captured: capture.captured,
          ok: capture.ok,
          reason: capture.reason,
        }, 'deal_intelligence_google_visual_capture');
      })
      // ── Close the loop ────────────────────────────────────────────────────
      // The mission is retrieval, not coverage. This is the part that was
      // missing: reconcile what the mission actually established, attempt the
      // machine-owned requirements it left open, and notify the specialist
      // layers so Property, Market, Seller and Deal Brain produce a CURRENT
      // read instead of waiting for the operator to click each one. Bounded to
      // one pass; a requirement nothing registered owns stays honestly open.
      .then(async () => {
        const current = getDealCard(id);
        if (!current) return;
        const cycle = await runDealCoverageCycle(id, current.entity as CapabilityEntity, 'operator_rerun');
        if ('error' in cycle) {
          logger.warn({ dealCardId: id, runId: launch.runId, msg: cycle.error }, 'research_coverage_cycle_skipped');
          return;
        }
        logger.info({
          dealCardId: id,
          runId: launch.runId,
          headline: cycle.after?.headline ?? cycle.plan.headline,
          attempted: cycle.attemptedItemIds,
          refreshedLayers: cycle.cascade?.refreshed ?? [],
          openRequirements: cycle.requirements.length,
        }, 'research_coverage_cycle_complete');
      })
      .catch((err) => logger.warn({ err, dealCardId: id, runId: launch.runId }, 'deal_intelligence_mission_failed'))
      // ── THE REAL LAST CLEANUP BOUNDARY ────────────────────────────────────
      // The mission's own scoped cleanup runs when the mission joins, but work
      // legitimately continues past that point: trailing provider lanes settle,
      // the accepted-identity visual capture runs, and background transports
      // finish. Anything those open is created AFTER the scoped sweep has
      // already looked, so it used to sit in the automation browser until an
      // operator ran `landos:browser reap` by hand.
      //
      // This is that reap, on the run's own tail. It is the automation
      // browser's own lifecycle call: it proves LandOS owns the endpoint before
      // touching anything, guarantees a control page survives so Chrome (and
      // its authenticated profile) stays up, and can never reach the operator's
      // browser. Best-effort by design — a cleanup failure must not fail a run
      // that already produced its result.
      .finally(async () => {
        try {
          const reaped = await reapOrphanAutomationTabs({
            dashboardOrigin: `http://localhost:${process.env.PORT ?? 3141}`,
          });
          // The reap can MINT a control page: closing the last orphan would take
          // Chrome down, so it creates a fresh about:blank first. That page is
          // born at the CDP level with no PageLike handle for the session module
          // to have marked, so it must be adopted here — before the next run's
          // research can acquire it as an ordinary working tab.
          const adopted = await adoptAutomationControlPage();
          logger.info({
            dealCardId: id,
            runId: launch.runId,
            closed: reaped.closed,
            remaining: reaped.remaining,
            controlPageAdopted: adopted,
          }, 'deal_intelligence_post_run_tab_reap');
        } catch (err) {
          logger.warn({ err, dealCardId: id, runId: launch.runId }, 'deal_intelligence_post_run_tab_reap_skipped');
        } finally {
          releaseFullRunLock();
        }
      });
    if (wait) await completion;
    return c.json({
      launch,
      identityReconciliation: null,
      propertyIntelligence: propertyIntelligenceView(id),
      coveragePlan,
      coverageCycle: wait ? researchCoverageCycles.get(id) ?? null : null,
    });
    } catch (error) {
      releaseFullRunLock();
      throw error;
    }
  });

  // ── Native mission graph: parent mission → child missions → join ───────────
  // One parent mission fans out to specialist CHILD missions, waits for every
  // required child to reach a terminal state, and joins their structured
  // handbacks. A failed, blocked or skipped child is always named in the parent
  // outcome; it is never silently dropped.
  const missionGraphStore = new MissionGraphStore();

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
    const runId = `property-resolution-compat-${id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const outcome = await propertyIntelligenceCollectors(id, 'deal_card', 'refresh').parcel_identity({
      dealCardId: id, runId, identity: null, comparables: null,
    });
    if (outcome.status === 'blocked' && /already running/i.test(outcome.summary)) {
      return c.json({
        dealCardId: id,
        capability: PROPERTY_RESOLUTION_CAPABILITY_ID,
        reusedActiveRun: true,
        active: { runId: null },
        propertyResolution: null,
        outcome: { status: outcome.status, summary: outcome.summary },
        parallelResolution: null,
        promoted: false,
        operatorConfirmationRequired: false,
      }, 202);
    }
    const currentDeal = getDealCard(id);
    const currentCardId = currentDeal ? subjectCardId(currentDeal) : null;
    if (currentCardId !== cardId) {
      return c.json({
        error: 'Deal Card subject changed while Property Resolution was running; the prior subject result was not returned.',
        expectedPropertyCardId: cardId,
        currentPropertyCardId: currentCardId,
      }, 409);
    }
    const result = new CapabilityInvocationStore().latestForProperty(cardId, id);
    const promoted = result?.subjectResolution === 'RESOLVED';
    const operatorConfirmationRequired = result?.subjectResolution === 'AMBIGUOUS';
    logger.info({ event: 'parallel_resolve_compatibility', dealCardId: id, capabilityInvocationId: result?.invocationId ?? null, subjectResolution: result?.subjectResolution ?? null }, 'parallel_resolve_compatibility');
    return c.json({
      dealCardId: id,
      capability: PROPERTY_RESOLUTION_CAPABILITY_ID,
      propertyResolution: result,
      outcome: { status: outcome.status, summary: outcome.summary },
      parallelResolution: null,
      promoted,
      operatorConfirmationRequired,
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
    }, OFFICIAL_PARCEL_LOOKUP_TIMEOUT_MS);
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
    const cardId = subjectCardId(deal);
    const retainedInspection = cardId ? loadPropertyInspection(cardId) : null;
    const retainedOwner = Object.entries(retainedInspection?.parcelFacts ?? {})
      .find(([label, value]) => /^owner(\s*name)?$/i.test(label.trim()) && !!String(value ?? '').trim())?.[1];
    const searchKey = {
      address: str(prop.active_input_address ?? undefined),
      apn: str(prop.apn ?? undefined),
      county: str(prop.county ?? undefined),
      state: str(prop.state ?? undefined),
      // A Deal Card can intentionally leave its mutable owner field blank while
      // the accepted parcel inspection retains the exact LandPortal owner. The
      // recorder fallback needs that owner only as a search key; the official
      // result must still repeat the exact subject APN before any fact persists.
      owner: str(prop.owner ?? undefined) ?? str(retainedOwner),
    };
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
    let recordedGovernmentOutcome: Record<string, unknown> | null = null;
    const recorderAttempt = countyRecords.sourceAttempts?.find((attempt) =>
      attempt.sourceType === 'recorder' && attempt.result === 'retrieved');
    const recorderFacts = countyRecords.facts.filter((fact) =>
      fact.sourceType === 'recorder' && fact.status === 'extracted');
    const exactApn = recorderFacts.find((fact) => fact.key === 'apn')?.value;
    if (
      recorderAttempt
      && exactApn
      && normalizeParcelIdentifier(exactApn) === normalizeParcelIdentifier(searchKey.apn)
    ) {
      const factMap = Object.fromEntries(recorderFacts.map((fact) => [fact.key, fact.value]));
      const instrument = str(factMap.instrumentNumber);
      const bookPage = str(factMap.recordBookPage) ?? str(factMap.deedRef);
      const recordedAt = str(factMap.recordingDate);
      const grantor = str(factMap.grantor);
      const grantee = str(factMap.grantee);
      const consideration = str(factMap.consideration);
      const description = str(factMap.legalDescription);
      const summary = [
        instrument ? `Instrument ${instrument}` : 'A recorded instrument',
        recordedAt ? `recorded ${recordedAt}` : null,
        bookPage ? `at Book/Page ${bookPage}` : null,
        grantor && grantee ? `conveys from ${grantor} to ${grantee}` : null,
        consideration ? `for recorded consideration ${consideration}` : null,
        description ? `with description "${description}"` : null,
        `and repeats exact subject APN ${exactApn}.`,
      ].filter(Boolean).join(' ');
      const documentUrl = [
        recorderAttempt.reachedUrl,
        ...countyRecords.sourceUrls,
      ].find((url) => /\/Image\/DocumentImage\d*\//i.test(url ?? '')) ?? null;
      recordedGovernmentOutcome = upsertPublicRecordOutcome({
        dealCardId: id,
        category: 'deed_ownership',
        title: instrument ? `Recorded deed ${instrument}` : 'Recorded deed matched to subject parcel',
        jurisdiction: [searchKey.county ? `${searchKey.county} County` : null, searchKey.state].filter(Boolean).join(', '),
        authority: recorderAttempt.sourceName,
        retrievalStatus: 'retrieved_yes',
        summary,
        facts: factMap,
        sourceUrl: recorderAttempt.sourceUrl,
        screenshotUrl: countyRecords.screenshots[0]?.path,
        documentUrl: documentUrl ?? undefined,
        searchedAt: recorderAttempt.attemptedAt,
      });
      try {
        synchronizeGovernmentRecordsForDeal({
          dealCardId: id,
          actor: 'county-records-browser',
          changeReason: 'Persisted an exact-APN official recorder result and retained its source evidence.',
        });
      } catch (error) {
        logger.warn({ err: error, dealCardId: id }, 'county_record_result_sync_failed');
      }
    }
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
    const evidenceAdmission = promoteBrowserFactsToEvidence(id);
    const readiness = evidenceAdmission.evidenceIds.length
      ? reconcileResearchReadiness(id)
      : null;
    return c.json({
      dealCardId: id, mode,
      landportal: redactEvidence(landportal),
      countyRecords: redactEvidence(countyRecords),
      recordedGovernmentOutcome,
      sellerAuthority,
      facts: listBrowserFacts(id),
      evidenceAdmission,
      readiness,
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

  // On-demand Land Score for a Deal Card's canonical subject. Property
  // Resolution owns the identity gate; scoring only reuses persisted facts.
  app.get('/api/landos/deal-cards/:id/land-score', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const deal = getDealCard(id);
    if (!deal) return c.json({ error: 'deal card not found' }, 404);
    const canonicalPropertyCardId = subjectCardId(deal);
    if (!canonicalPropertyCardId) return c.json({ landScore: null, parcelVerified: false, note: 'Canonical subject Property Card is missing.' }, 409);
    const prop = deal.propertyCards?.[0] as { active_input_address?: string | null; apn?: string | null; county?: string | null; state?: string | null } | undefined;
    const identityText = buildIdentityText(deal, getDealCardDd(id));
    const lookup = identityText || prop?.active_input_address || prop?.apn || deal.title;
    if (!lookup) {
      return c.json({ landScore: null, parcelVerified: false, note: 'No parcel identifier on this Deal Card to resolve.' });
    }
    const capability = await invokeRuntimeCapability({
      capabilityId: PROPERTY_RESOLUTION_CAPABILITY_ID,
      caller: { type: 'deal_card', ref: `deal:${id}:land-score` },
      subject: { kind: 'canonical_property', entity: isEntity(deal.entity) ? deal.entity : 'TY_LAND_BIZ', propertyCardId: canonicalPropertyCardId, dealCardId: id },
      mode: 'reuse',
      context: { surface: 'deal_card', action: 'land_score' },
    });
    if (capability.subjectResolution !== 'RESOLVED') {
      return c.json({ landScore: null, parcelVerified: false, capability, note: 'Parcel not source-verified â€” Land Score not computed (never scored from unverified data).' });
    }
    const refreshedDeal = getDealCard(id);
    const verifiedCard = (refreshedDeal?.propertyCards as Array<Record<string, unknown>> | undefined)?.find(
      (cd) => cd.id === canonicalPropertyCardId && cd.verification_status === 'verified_property' &&
        (String(cd.apn ?? '').trim() || String(cd.lp_property_id ?? '').trim() || String(cd.parcel_id ?? '').trim() || String(cd.active_input_address ?? '').trim()),
    );
    if (!verifiedCard) {
      return c.json({ landScore: null, parcelVerified: false, capability, note: 'Canonical subject has no persisted verified facts to score.' });
    }
    const verification = await runDukeVerification(lookup, {
      resolve: buildPersistedResolver(verifiedCard),
      timeoutMs: LANDPORTAL_VERIFICATION_TIMEOUT_MS,
    });
    if (!verification.parcelVerified) {
      return c.json({ landScore: null, parcelVerified: false, note: 'Parcel not source-verified — Land Score not computed (never scored from unverified data).' });
    }
    // Consume approved-provider data: verified property data + the LandPortal
    // parcel fact sheet (road frontage, wetlands, FEMA, buildability, acreage,
    // valuation) so LandPortal data is scored, not ignored (2026-07-04 correction).
    const scoreSubjectCardId = ((verifiedCard?.id ?? (deal.propertyCards?.[0] as { id?: number } | undefined)?.id)) as number | undefined;
    const inspection = scoreSubjectCardId ? loadPropertyInspection(scoreSubjectCardId) : null;
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
    return c.json({ landScore, parcelVerified: true, capability, note: '' });
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
    const root = landosArtifactPath('visuals');
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
    if (!isAcceptedLandPortalVisualForProperty(asset.validation, cardId)) {
      return c.json({ error: 'image excluded: visual validation did not bind it to this Property Card' }, 404);
    }
    const resolved = path.resolve(asset.storedPath);
    const root = landosArtifactPath('visuals');
    if (!resolved.startsWith(root + path.sep)) return c.json({ error: 'forbidden' }, 403);
    try {
      const buf = fs.readFileSync(resolved);
      return new Response(new Uint8Array(buf), { headers: { 'content-type': 'image/png', 'cache-control': 'private, no-store' } });
    } catch {
      return c.json({ error: 'image not found' }, 404);
    }
  });

  // ── Browser Use LandPortal pilot ─────────────────────────────────────────
  // Adaptive LandPortal research through the SAME paired authenticated Chrome
  // session. Fire-and-poll: POST starts the run, GET reports status + the
  // newest persisted result, the image route serves labeled evidence captures
  // (token-gated, confined to the configured screenshot dir).
  app.post('/api/landos/deal-cards/:id/browseruse/run', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const current = browserUseRunStatus(id);
    if (current.state === 'running' || current.state === 'queued') {
      return c.json({ error: 'A Browser Use run is already in progress for this deal card.', status: current }, 409);
    }
    // mode 'staged' (default): deterministic hybrid stages + local/remote
    // interpretation model. mode 'agent': the original Browser Use full-agent
    // path, kept for adaptive recovery and benchmarking.
    const body = await c.req.json().catch(() => ({})) as { mode?: string; provider?: string; captureLabels?: unknown };
    const mode = body.mode === 'agent' ? 'agent' : 'staged';
    const provider = body.provider === 'google' ? 'google' : body.provider === 'ollama' ? 'ollama' : 'auto';
    const allowedCaptureLabels = new Set([
      'road_frontage_aerial', 'close_parcel_aerial', 'clean_parcel_aerial', 'wider_context',
      'surrounding_area_aerial',
      'wetlands_overlay', 'soil_overlay', 'contour_terrain_view', 'fema_flood_overlay',
      'front_side_3d', 'rear_side_3d',
    ]);
    const captureLabels = Array.isArray(body.captureLabels)
      ? [...new Set(body.captureLabels.filter((label): label is string => typeof label === 'string' && allowedCaptureLabels.has(label)))]
      : undefined;
    // Deliberately not awaited: the run takes minutes; the UI polls status.
    // Serialized through the shared single-Chrome mission gate so neither path
    // ever runs while a Puppeteer mission is using the paired browser.
    markBrowserUseQueued(id);
    void withBrowserMissionGate<void>(async () => {
      if (mode === 'agent') { await runLandPortalBrowserUsePilot(id); return; }
      await runLandPortalStagedPilotTracked(id, provider, captureLabels);
    }).catch((err) => {
      logger.warn({ dealCardId: id, err: err instanceof Error ? err.message : String(err) }, 'browseruse run rejected unexpectedly');
    });
    return c.json({ started: true, mode, provider, status: browserUseRunStatus(id) }, 202);
  });

  app.get('/api/landos/deal-cards/:id/browseruse', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const subjectCard = subjectForDealCard(id);
    return c.json({
      status: browserUseRunStatus(id),
      run: loadBrowserUseRunForDeal(id),
      stages: subjectCard ? loadStagedRun(subjectCard.propertyCardId) : [],
      soilDetails: soilDetailsForDealCard(id),
    });
  });

  app.get('/api/landos/deal-cards/:id/browseruse/image/:file', (c) => {
    const id = Number(c.req.param('id'));
    const file = c.req.param('file') ?? '';
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    if (!hasPersistedBrowserUseCaptureForDeal(id, file)) {
      return c.json({ error: 'no such capture for this deal card' }, 404);
    }
    const resolved = resolveBrowserUseCapturePath(file);
    if (!resolved) return c.json({ error: 'forbidden' }, 403);
    try {
      const buf = fs.readFileSync(resolved);
      return new Response(new Uint8Array(buf), { headers: { 'content-type': 'image/png', 'cache-control': 'private, no-store' } });
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

    const rawRecord = await vi.runVisualIntelligenceForCard(
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
    // A successful live LandPortal capture is also the canonical parcel image
    // shown at the top of the Deal Card. Persist it under the existing
    // `parcel_page` key so the wider neighbor-context view replaces the older,
    // tightly cropped screenshot without erasing any other inspection evidence.
    const liveLandPortal = rawRecord.sources.find((source) =>
      source.source === 'landportal'
      && source.state === 'captured'
      && typeof source.storedPath === 'string'
      && path.basename(source.storedPath).startsWith(`vi_${id}_landportal_`),
    );
    if (liveLandPortal?.storedPath) {
      savePropertyInspection(id, {
        parcelUrl: inspection?.parcelUrl ?? (card.lp_url as string) ?? null,
        comparablesUrl: inspection?.comparablesUrl ?? null,
        parcelFacts: {},
        assets: [{
          key: 'parcel_page',
          label: 'LandPortal Parcel + Neighbor Context',
          kind: 'parcel_page',
          purpose: 'Parcel-context 2D view: the complete subject boundary centered with the immediately surrounding parcels and fronting road readable.',
          sourcePath: liveLandPortal.storedPath,
          timestamp: liveLandPortal.timestamp,
          note: 'Authenticated LandPortal 2D parcel view. Map fitted to the subject, then stepped out to parcel-context scale before capture.',
        }],
        overlays: [],
        visualObservations: [],
        comparables: [],
      });
    }
    const record = vi.sanitizeVisualIntelligenceRecord(
      rawRecord,
      { eligibleGoogle: loadEligibleCardVisualCapture(id), rawGoogle: loadCardVisualCapture(id) },
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
    const root = landosArtifactPath('visuals');
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

  // ── Market Research — retained quarterly LandPortal snapshots ───────
  // The Market Research department workspace (Heat Map + Drill Deep) reads
  // ONLY LandOS-retained snapshot data. Collection runs through the visible
  // authenticated LandPortal Drill Deep workflow; diagnostics stay internal.

  app.get('/api/landos/market-research/overview', (c) => {
    importMatrixBaseline(); // idempotent: attach already-retained LandPortal rows once
    const snapshots = listMrSnapshots();
    return c.json({
      snapshots,
      dictionary: MR_METRIC_DICTIONARY,
      collection: getCollectionStatus(),
      bands: ['all', '0-1', '1-2', '2-5', '5-10', '10-20', '20-50', '50-100', '100+'].map((band) => ({
        band,
        // A band is only presented when real retained results exist for it.
        retained: snapshots.some((s) => s.filters.acreageBand === band && (s.counts.state + s.counts.county + s.counts.zip) > 0),
      })),
    });
  });

  app.get('/api/landos/market-research/snapshots/:id/rows', (c) => {
    const id = Number(c.req.param('id'));
    const level = str(c.req.query('level'));
    if (!Number.isFinite(id) || !level || !['state', 'county', 'zip'].includes(level)) {
      return c.json({ error: 'snapshot id and level=state|county|zip required' }, 400);
    }
    const snapshot = getMrSnapshot(id);
    if (!snapshot) return c.json({ error: 'unknown snapshot' }, 404);
    const parent = str(c.req.query('parent'));
    return c.json({ snapshot, rows: listMrRows(id, level as 'state' | 'county' | 'zip', parent || undefined) });
  });

  app.get('/api/landos/market-research/snapshots/:id/summary', (c) => {
    const id = Number(c.req.param('id'));
    const geo = str(c.req.query('geo'));
    if (!Number.isFinite(id) || !geo) return c.json({ error: 'snapshot id and geo key required' }, 400);
    const summary = getMrGeoSummary(id, geo);
    if (!summary) return c.json({ error: 'no retained result for this geography in this snapshot' }, 404);
    return c.json({ summary });
  });

  // ZIP (ZCTA) polygons — retained in landos_mr_geometry; fetched once from
  // the free public Census TIGERweb service when missing.
  app.get('/api/landos/market-research/zip-geometry', async (c) => {
    const zips = (str(c.req.query('zips')) ?? '').split(',').map((z) => z.trim()).filter(Boolean);
    if (zips.length === 0 || zips.length > 200) return c.json({ error: '1–200 comma-separated ZIPs required' }, 400);
    return c.json(await getZipGeometries(zips));
  });

  // The normal internal workflow: "Collect quarterly land market snapshot".
  // Runs the visible LandPortal Drill Deep flow; resumable and idempotent.
  app.post('/api/landos/market-research/collect', async (c) => {
    if (isCollectionActive()) return c.json({ started: false, note: 'A collection run is already in progress.' });
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const maxStates = typeof body.maxStateExpansions === 'number' ? body.maxStateExpansions : undefined;
    const maxZips = typeof body.maxZipExpansions === 'number' ? body.maxZipExpansions : undefined;
    const states = Array.isArray(body.states) ? body.states.filter((s): s is string => typeof s === 'string') : undefined;
    void collectQuarterlyMarketSnapshot({
      states, maxStateExpansions: maxStates, maxZipExpansions: maxZips,
      onProgress: (m) => logger.info({ scope: 'market-research-collect' }, m),
    }).catch((e) => logger.error({ scope: 'market-research-collect', err: String(e) }, 'collection run failed'));
    return c.json({ started: true });
  });

  app.get('/api/landos/market-research/collect/status', (c) => c.json(getCollectionStatus()));

  // Verify-and-complete sweep: normal visible clicks, retention from the
  // grid's OWN JSON payloads; declared ZIP counts prove per-county coverage.
  app.post('/api/landos/market-research/verify-sweep', async (c) => {
    if (isCollectionActive()) return c.json({ started: false, note: 'A collection, gap-fill, or sweep run is already in progress.' });
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    void collectMarketVerifySweep({
      maxStateVisits: typeof body.maxStateVisits === 'number' ? body.maxStateVisits : undefined,
      onProgress: (m) => logger.info({ scope: 'market-research-sweep' }, m),
    }).catch((e) => logger.error({ scope: 'market-research-sweep', err: String(e) }, 'verify-sweep run failed'));
    return c.json({ started: true });
  });

  // Audited ADD-ONLY gap fill: re-reads every retained geography that has a
  // missing metric from the live Drill Deep grid, fills only absent values,
  // and verifies the rest as blank on the provider itself.
  app.post('/api/landos/market-research/fill-gaps', async (c) => {
    if (isCollectionActive()) return c.json({ started: false, note: 'A collection or gap-fill run is already in progress.' });
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    void collectMarketGapFill({
      maxStateVisits: typeof body.maxStateVisits === 'number' ? body.maxStateVisits : undefined,
      maxCountyOpens: typeof body.maxCountyOpens === 'number' ? body.maxCountyOpens : undefined,
      onProgress: (m) => logger.info({ scope: 'market-research-gap-fill' }, m),
    }).catch((e) => logger.error({ scope: 'market-research-gap-fill', err: String(e) }, 'gap-fill run failed'));
    return c.json({ started: true });
  });

  // ── Browser Agent — its own employee; owns browser automation ───────
  // The Browser Agent EXECUTES Browser Playbooks and returns validated-shape
  // data. Market Intelligence delegates market collection here. The agent never
  // permanently knows any website; LandPortal Market Research is Playbook #1.
  const browserAgentSummary = () => {
    const operationalBackend = pickMarketResearchBackend('operational');
    const info = playbookInfo(landportalMarketResearchPlaybook, operationalBackend);
    const runs = listBrowserAgentRuns(undefined, 50);
    // This page previously claimed the live backend was "not wired" even when
    // the agent had just completed a real LandPortal run. Report only the
    // current in-process session state here; do not create a fresh CDP
    // connection merely to render a status page.
    const sessionState = browserSessionStatus();
    const liveVisualNavigation = {
      live: 'connected',
      auth_needed: 'authentication needed',
      disabled: 'not connected',
      unreachable: 'not reachable',
    }[sessionState];
    return {
      employee: { id: 'browser_agent', name: 'Browser Agent', role: 'Browser automation and Browser Playbook execution' },
      liveVisualNavigation,
      liveVisualNote: `Live LandPortal session is ${liveVisualNavigation}.`,
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
