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
import { runUnderwriting, type UnderwritingStrategyLane } from './underwriting-agent.js';
import { DashboardSettingsOverrideStore, resolveOverride, setOverride, resetOverride, type OverrideScope } from './model-override.js';
import { PROVIDER_PRESENCE } from '../config.js';
import { getDashboardSetting, setDashboardSetting } from '../db.js';
import { RUBRIC_FACTORS, RUBRIC_SOURCE, RUBRIC_STATUS, VERDICT_TIERS } from './rubric.js';
import { STRATEGIES, evaluateStrategies } from './offer-engine.js';
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
  loadPropertyInspection,
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
import { buildSmartIntake } from './smart-intake.js';
import { planResolver, type IntakeFields } from './resolver-planner.js';
import { buildDiscoveryCallReport, type DiscoveryIntake } from './discovery-call-report.js';
import { resolveProperty, type ResolutionDeps } from './property-resolution-engine.js';
import { browserLaneStatus } from './browser-retrieval.js';
import { makeLandPortalBrowser } from './landportal-browser.js';
import { makeCountyRecordsBrowser } from './county-records-browser.js';
import { routeBrowserQuestion, type BrowserEvidence } from './browser-intelligence.js';
import { makeLiveBrowserDriver, ensureBrowserSession, browserSessionHealth, startBrowserSession, openLandPortalInSession, withWorkingPage } from './browser-session.js';
import { getCountySources } from './county-source-map.js';
import { writeBrowserFact, listBrowserFacts, requestCancel, isCancelled, clearCancel, markStoppedByOperator } from './browser-fact-store.js';
import { assessSellerAuthority } from './seller-authority.js';
import type { BrowserFact, BrowserSearchMode } from './browser-intelligence.js';
import { deriveCounty } from './providers/county-geocode.js';
import { buildDealCardUpdatePlan } from './deal-card-memory.js';
import { buildMarketPulseV1 } from './market-pulse.js';
import { fetchMarketPulseRead, type PulseComp } from './market-pulse-read.js';
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
import { listDealCards, getDealCard, createDealCard, updateDealCard, ensureDealCardForProperty, getDealCardIdForPropertyCard } from './deal-card.js';
import { assembleBusinessObjects, whatBlocksThisDeal } from './business-object-spine.js';
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

const fmtMoney = (n: unknown): string => (typeof n === 'number' && Number.isFinite(n) ? `$${Math.round(n).toLocaleString()}` : 'Unavailable');
const fmtText = (v: unknown, fallback = 'Unavailable'): string => (typeof v === 'string' && v.trim() ? v.trim() : fallback);

function propertyIntelligenceMarkdown(input: {
  deal: unknown;
  report: ReturnType<typeof getDealCardReport>;
  executiveSummary: ReturnType<typeof buildExecutiveSummary>;
  discoveryReport?: ReturnType<typeof buildDiscoveryCallReport>;
  briefing?: ReturnType<typeof buildDiscoveryBriefing>;
}): string {
  const { deal, report, executiveSummary, discoveryReport, briefing } = input;
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
  if (inspection && Object.keys(inspection.parcelFacts).length > 0) {
    lines.push('');
    lines.push(`### All Visible LandPortal Fields`);
    for (const [k, v] of Object.entries(inspection.parcelFacts)) lines.push(`- ${k}: ${v}`);
  }
  lines.push('');
  lines.push(`## LandPortal Due Diligence`);
  lines.push(inspection?.parcelUrl ? `Parcel source: ${inspection.parcelUrl}` : 'Parcel source: Unavailable');
  lines.push(`- Road frontage: ${fmtText(inspection?.parcelFacts?.['Road Frontage'])}`);
  lines.push(`- Landlocked: ${fmtText(inspection?.parcelFacts?.['Land Locked'])}`);
  lines.push(`- Buildability: ${fmtText(inspection?.factSheet?.buildability?.pct ?? inspection?.parcelFacts?.['Buildability total (%)'])}`);
  lines.push(`- Assessment / valuation: ${fmtText(inspection?.parcelFacts?.['Assessment'] ?? inspection?.parcelFacts?.['Total Market Value'] ?? inspection?.parcelFacts?.['Market Value'])}`);
  lines.push(`- Sale history: ${fmtText(inspection?.parcelFacts?.['Last Sale'] ?? inspection?.parcelFacts?.['Sale Date'])}`);
  lines.push(`- Mortgage information: ${fmtText(inspection?.parcelFacts?.Mortgage ?? inspection?.parcelFacts?.['Mortgage Amount'])}`);
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
  if (comps.length === 0) lines.push('No comparable rows were extracted in the current run.');
  for (const c of comps.slice(0, 20) as Array<Record<string, unknown>>) {
    lines.push(`- ${fmtText(c.status, 'unknown')}${c.address ? ` | ${c.address}` : ''}${c.apn ? ` | APN ${c.apn}` : ''}${c.acres ? ` | ${c.acres} ac` : ''}${c.price ? ` | ${fmtMoney(c.price)}` : ''}${c.pricePerAcre ? ` | ${fmtMoney(c.pricePerAcre)}/ac` : ''}${c.distanceMiles ? ` | ${c.distanceMiles} mi` : ''}`);
  }
  lines.push('');
  lines.push(`## Market Pulse`);
  lines.push(marketPulse);
  if (market) {
    if (market.opportunities.length) lines.push(`Opportunities: ${market.opportunities.join('; ')}`);
    if (market.risks.length) lines.push(`Risks: ${market.risks.join('; ')}`);
  }
  lines.push('');
  lines.push(`## Land Score`);
  lines.push(score ? `${score.score}/${score.maxScore} - ${score.verdict} (${score.confidence}). ${score.note}` : 'Land Score unavailable because parcel identity or required facts are incomplete.');
  for (const f of score?.factors ?? []) lines.push(`- ${f.label}: ${f.points}/${f.maxPoints} - ${f.basis}${f.dataGap ? ' (data gap)' : ''}`);
  lines.push('');
  lines.push(`## Strategy`);
  for (const s of strategyRows) lines.push(`- ${s.strategy}: ${s.potential ?? s.verdict}. ${s.reason} Pricing: ${s.pricingLogic} Risk: ${s.mainRisk}`);
  lines.push(`Primary strategy: ${report.mostViableStrategy || 'Unavailable'}`);
  lines.push('');
  lines.push(`## Offer Guidance`);
  if (offer?.acquisition?.low != null && offer.acquisition.high != null) lines.push(`40-60% guidance: ${fmtMoney(offer.acquisition.low)} to ${fmtMoney(offer.acquisition.high)}. ${offer.note}`);
  else lines.push('Valuation cannot yet be determined from sufficient evidence.');
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

function suppressWeakerDuplicatePropertyCards<T extends { id: number; address_key?: string | null; verification_status?: string | null }>(cards: T[]): T[] {
  const verifiedAddressKeys = new Set(cards
    .filter((card) => card.verification_status === 'verified_property' && (card.address_key ?? '').trim())
    .map((card) => (card.address_key ?? '').trim()));
  if (!verifiedAddressKeys.size) return cards;
  return cards.filter((card) => {
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
    verify: verifyFromFields,
    deriveCounty: (f) => deriveCounty({ address: f.address, city: f.city, state: f.state, zip: f.zip }),
    suggest: (q) => suggestAddresses(q),
    // Browser Intelligence: LandPortal-first, then County gap-fill, backed by the
    // live persistent-session driver. configured() is true only when the operator's
    // Chrome session is connected; otherwise the services report parked (honest).
    // Never stores a credential; never prints cookies/tokens.
    landPortalBrowser: makeLandPortalBrowser({ driver: makeLiveBrowserDriver('landportal') }),
    countyRecordsBrowser: makeCountyRecordsBrowser({ driver: makeLiveBrowserDriver('county_records') }),
    timeoutMs,
  };
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

  // Kanban board: cards grouped by status column (property-centered).
  app.get('/api/landos/board', (c) => {
    const entity = entityParam(c.req.query('entity'));
    const cards = withPropertyWorkspaceSummary(suppressWeakerDuplicatePropertyCards(listPropertyCards({ entity, limit: 500 })));
    const columns: Record<string, unknown[]> = {};
    for (const s of KANBAN_STATUSES) columns[s] = [];
    for (const card of cards) columns[(card as { kanban_status: string }).kanban_status]?.push(card);
    return c.json({ columns, statuses: KANBAN_STATUSES });
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
      const result = setCardVerificationStatus(id, vs as CardVerificationStatus, str(body.actor) ?? 'tyler', str(body.reason) ?? '');
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
    const rows = listComps({ dealCardId: id });
    const comps: PulseComp[] = rows.map((r) => ({
      pricePerAcre: r.price_per_acre, price: r.price, acres: r.acres,
      zip: (String(r.address_desc || '').match(/\b(\d{5})\b/) ?? [])[1] ?? null,
    }));
    const marketPulse = await fetchMarketPulseRead({
      city: str(subj?.city) || undefined,
      county: str(subj?.county) || dd.county || undefined,
      state: str(subj?.state) || dd.state || undefined,
      zip: (addr.match(/\b(\d{5})\b/) ?? [])[1],
      fips: str(subj?.fips) || undefined,
      parcelVerified: deal.hasVerifiedProperty === true,
      comps,
    });
    return c.json({ marketPulse });
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
    const decision = runUnderwriting({
      apn: String(id),
      parcelVerified: deal.hasVerifiedProperty === true,
      expectedValueUsd: typeof body.expectedValueUsd === 'number' ? body.expectedValueUsd : null,
      strategyLanes: Array.isArray(body.strategyLanes) ? (body.strategyLanes as UnderwritingStrategyLane[]) : [],
      discoveryCallSummary: str(body.discoveryCallSummary) ?? null,
      newDisclosures: Array.isArray(body.newDisclosures) ? (body.newDisclosures as string[]) : [],
      sellerNotes: str(body.sellerNotes) ?? null,
      knownConstraints: Array.isArray(body.knownConstraints) ? (body.knownConstraints as string[]) : [],
      compsAttached: body.compsAttached === true,
      marketFactsAttached: body.marketFactsAttached === true,
    });
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
    const zip = address?.match(/\b(\d{5})(?:-\d{4})?\b/)?.[1];
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
    const zip = sv(pc.zip) ?? (sv(pc.active_input_address) ?? sv(d.title))?.match(/\b(\d{5})(?:-\d{4})?\b/)?.[1];
    const acres = typeof pc.acres === 'number' && pc.acres > 0 ? pc.acres : null;
    return resolveMarketMatrixSection({ state: sv(pc.state), county: sv(pc.fips) ?? sv(pc.county), zip, acres, side: 'sold' });
  };

  app.get('/api/landos/deal-cards/:id/report', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const deal = getDealCard(id);
    if (!deal) return c.json({ error: 'deal card not found' }, 404);
    const report = getDealCardReport(id);
    const cardId = subjectCardId(deal);
    const sellerSummary = summarizeSellerFacts(cardId ? loadSellerStatedFacts(cardId) : []);
    const readiness = computeDealCardReadiness(report, {
      dealUpdatedAt: (deal as { updated_at?: number }).updated_at,
      sellerFacts: sellerSummary,
      hasCountyVerification: !!cardId && loadCountyVerificationRecords(cardId).length > 0,
    });
    const briefing = buildDiscoveryBriefing(report, readiness, sellerSummary);
    const { preCallIntelligence, propertyType } = synthPreCall(report as unknown as Record<string, unknown>, deal as unknown as Record<string, unknown>, cardId);
    const leadTypeRaw = (deal as unknown as { lead_type?: string }).lead_type;
    const leadType: LeadType = isLeadType(leadTypeRaw) ? leadTypeRaw : 'actual';
    const browserMarketIntel = await browserIntelFor(deal as unknown as Record<string, unknown>);
    const { summarizeGrowthDrivers } = await import('./browser-market-intelligence.js');
    const growthSummary = summarizeGrowthDrivers(browserMarketIntel as never);
    const executiveSummary = buildExecutiveSummary(report, growthSummary);
    const discoveryReport = buildDiscoveryCallReport(report, executiveSummary, buildDiscoveryIntake(deal));
    const marketMatrix = marketMatrixFor(deal);
    discoveryReport.marketMatrix = marketMatrix;
    return c.json({ report, executiveSummary, discoveryReport, marketMatrix, growthSummary, readiness, briefing, preCallIntelligence, propertyType, leadType, leadTypeLabel: LEAD_TYPE_LABEL[leadType], govDd: report.govDd, browserMarketIntel });
  });

  app.get('/api/landos/deal-cards/:id/report/download', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid id' }, 400);
    const deal = getDealCard(id);
    if (!deal) return c.json({ error: 'deal card not found' }, 404);
    const report = getDealCardReport(id);
    if (!report.exists) return c.json({ error: 'run Property Intelligence before downloading a report' }, 400);
    const cardId = subjectCardId(deal);
    const sellerSummary = summarizeSellerFacts(cardId ? loadSellerStatedFacts(cardId) : []);
    const readiness = computeDealCardReadiness(report, {
      dealUpdatedAt: (deal as { updated_at?: number }).updated_at,
      sellerFacts: sellerSummary,
      hasCountyVerification: !!cardId && loadCountyVerificationRecords(cardId).length > 0,
    });
    const briefing = buildDiscoveryBriefing(report, readiness, sellerSummary);
    const browserMarketIntel = await browserIntelFor(deal as unknown as Record<string, unknown>);
    const { summarizeGrowthDrivers } = await import('./browser-market-intelligence.js');
    const growthSummary = summarizeGrowthDrivers(browserMarketIntel as never);
    const executiveSummary = buildExecutiveSummary(report, growthSummary);
    const discoveryReport = buildDiscoveryCallReport(report, executiveSummary, buildDiscoveryIntake(deal));
    const marketMatrix = marketMatrixFor(deal);
    discoveryReport.marketMatrix = marketMatrix;
    const markdown = propertyIntelligenceMarkdown({ deal, report, executiveSummary, discoveryReport, briefing });
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
        landPortalBrowser: makeLandPortalBrowser({ driver: makeLiveBrowserDriver('landportal') }),
        countyRecordsBrowser: makeCountyRecordsBrowser({ driver: makeLiveBrowserDriver('county_records') }),
        googleVisualConfigured: googleVisualConfiguredResolved(),
      });
      persistPropertyInspection(cardIdBeforeRun, inspectionResult.inspection);
    }
    // Wire the REAL bounded non-credit LandPortal exact resolver. This is the
    // same safe path the Duke verification route uses — not a comp tool/credit.
    const result = await runDealCardReport(id, {
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
      captureZillowComps: fetchZillowLandComps,
      captureRedfinComps: fetchRedfinLandComps,
    });
    if (!result) return c.json({ error: 'deal card not found' }, 404);
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
    const { summarizeGrowthDrivers } = await import('./browser-market-intelligence.js');
    const growthSummary = summarizeGrowthDrivers(browserMarketIntel as never);
    const executiveSummary = buildExecutiveSummary(result.report, growthSummary);
    const discoveryReport = deal ? buildDiscoveryCallReport(result.report, executiveSummary, buildDiscoveryIntake(deal)) : undefined;
    const marketMatrix = deal ? marketMatrixFor(deal) : undefined;
    if (discoveryReport && marketMatrix) discoveryReport.marketMatrix = marketMatrix;
    return c.json({ ...result, executiveSummary, discoveryReport, marketMatrix, growthSummary, readiness, briefing, preCallIntelligence, propertyType, govDd: result.report.govDd, browserMarketIntel });
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
      })) as { warnings?: string[] } | null;
      if (rep && Array.isArray(rep.warnings)) reportWarnings = rep.warnings;
    } catch {
      reportWarnings = ['Worksheet population deferred — run the report from the Deal Card.'];
    }

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
    const browserStart = await startBrowserSession();
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
        const { card } = upsertCardFromDukeRun({
          entity, agentId: 'acquire',
          activeInputAddress: researchAddr,
          city: f.city, state: f.state, county: f.county, apn: f.apn, fips: f.fips, owner: f.owner,
          verified: false,
          summary: 'Acquire — research lead (unresolved). Public-records research plan attached; not verified.',
        });
        const dealCardId = ensureDealCardForProperty({ cardId: card.id, entity, title: researchAddr });
        const plan = buildPublicRecordsResearchPlan({ county: f.county, state: f.state, city: f.city, apn: f.apn, owner: f.owner, address: f.address });
        for (const action of researchPlanNextActions(plan)) {
          try { addCardNextAction({ cardId: card.id, action, createdBy: 'acquire-research' }); } catch { /* one action failing never blocks the card */ }
        }
        logger.info({ event: 'acquire_run', ok: true, matched: false, researchCard: true, confidence: resolution.confidence, dealCardId, pipeline: 'property_resolution' }, 'acquire_run_research_card');
        return c.json({
          ok: true, matched: false, researchCardCreated: true, parcelVerified: false, dealCardId,
          status: 'research_card', confidence: resolution.confidence,
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
      entity, agentId: 'acquire',
      activeInputAddress: subjectAddress,
      city: p.city, state: p.state, county: p.county,
      apn: p.apn, lpPropertyId: p.propertyId, fips: p.fips, lpUrl: p.lpUrl ?? browserProof.sourceUrl, owner: p.owner, acres: p.acres,
      lat: p.coordinates?.lat ?? null, lng: p.coordinates?.lng ?? null,
      verified: propertyVerified,
      verificationSource: p.parcelVerified ? (p.verificationSource ?? 'Realie.ai (non-credit)') : (browserVerified ? browserProof.source : undefined),
      summary: propertyVerified ? 'Acquire — verified parcel' : 'Acquire — matched (Confirm Before Offer)',
    });
    const dealCardId = ensureDealCardForProperty({ cardId: card.id, entity, title: subjectAddress });
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
        searchKey: { address: subjectAddress, apn: p.apn, owner: p.owner, city: p.city, county: p.county, state: p.state, zip: tf.zip },
        existingEvidence: resolution.browserEvidence ?? [],
        timeoutMs: LANDPORTAL_VERIFICATION_TIMEOUT_MS,
      }, {
        landPortalBrowser: makeLandPortalBrowser({ driver: makeLiveBrowserDriver('landportal') }),
        countyRecordsBrowser: makeCountyRecordsBrowser({ driver: makeLiveBrowserDriver('county_records') }),
        googleVisualConfigured: googleVisualConfiguredResolved(),
      });
      persistPropertyInspection(card.id, inspectionResult.inspection);
      if (streamed.size) logger.info({ event: 'acquire_browser_intel', dealCardId, facts: streamed.size }, 'acquire_browser_intel_persisted');
    } catch { /* non-fatal surfacing */ }
    if (hasCriticalParcelGaps(p)) {
      const browserStatuses = (resolution.browserEvidence ?? []).map((b) => `${b.service}:${b.status}`).join(', ') || 'none';
      const note = browserStart.status === 'live'
        ? `Browser escalation attempted (${browserStatuses}); missing fields remain: ${resolution.missing.join(', ') || 'critical parcel facts'}.`
        : `Browser escalation could not run (${browserStart.status}${browserStart.error ? `: ${browserStart.error}` : ''}). Start/login Browser Intelligence, then rerun.`;
      try { addCardNextAction({ cardId: card.id, action: note, createdBy: 'acquire-browser-escalation' }); } catch { /* best-effort operator note */ }
    }
    // Run the full production DD report. reverify:true forces a FRESH full
    // property-data lookup (using the card's now-verified APN + county) rather
    // than reusing the resolution's identity-only card — otherwise acreage / land
    // use / zoning land facts (and the acquisition range + strategy scoring that
    // depend on acreage) would show as gaps on a verified parcel. Same provider
    // (non-credit); the card carries the strong identifier so it re-verifies.
    const result = await runDealCardReport(dealCardId, {
      resolve: resolveParcelIdentityResult,
      timeoutMs: LANDPORTAL_VERIFICATION_TIMEOUT_MS,
      reverify: !browserVerified,
      googleVisualConfigured: googleVisualConfiguredResolved(),
      captureZillowComps: fetchZillowLandComps,
      captureRedfinComps: fetchRedfinLandComps,
    });
    const reportVerified = result?.report.parcelVerified === true;
    logger.info({ event: 'acquire_run', ok: true, matched: true, parcelVerified: reportVerified, confidence: resolution.confidence, dealCardId, pipeline: 'property_resolution' }, 'acquire_run');
    return c.json({
      ok: true, matched: true,
      parcelVerified: reportVerified,
      dealCardId,
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
  // path is never exposed to the browser. Makes NO Google call.
  app.get('/api/landos/visual/image', (c) => {
    const cardId = Number(c.req.query('cardId'));
    const service = c.req.query('service') ?? '';
    if (!Number.isInteger(cardId)) return c.json({ error: 'invalid cardId' }, 400);
    if (!(VISUAL_SERVICES as readonly string[]).includes(service)) return c.json({ error: 'invalid service' }, 400);
    const asset = loadCardVisualCapture(cardId)[service];
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
