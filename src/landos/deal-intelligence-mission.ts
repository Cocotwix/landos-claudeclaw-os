// The Deal Intelligence parent mission — Phase 5, Items 18 and 19.
//
// ONE operator action ("Run Property Intelligence") creates ONE parent mission
// on the Phase 4 native mission graph. The parent fans out to specialist CHILD
// missions, waits for them in dependency waves, and hands its joined result to
// the Operator/Analyst assembly stage (deal-intelligence-assembly.ts and
// deal-intelligence-analysis.ts), which persists ONE current snapshot.
//
// What this module is, and is NOT:
//   • It IS the mission DEFINITION: which specialists exist, who owns each lane,
//     what each must deliver to be accepted, and what each waits for.
//   • It is NOT a new research system. Every lane delegates to a collector that
//     already works (property-intelligence-live.ts) or to an injected capability
//     that already works (the LandPortal/county subject research, Market Pulse).
//     Phase 5 reuses those; it does not rebuild them.
//
// Two rules from the Phase 5 brief are encoded structurally rather than left to
// good intentions:
//
//   1. "Missing information ... must not automatically block valuation, downgrade
//      the entire recommendation, or place the whole deal on hold."
//      Lanes that merely INFORM a conclusion are declared with `awaits`, not
//      `dependsOn`. A blocked zoning lane orders valuation after it but never
//      cancels it; the gap is disclosed in the conclusion it actually affects.
//      Only a lane a child genuinely cannot work without is a hard `dependsOn`.
//
//   2. "Do not perform assessor, recorder, deed, parcel, or other government-record
//      verification on comps."
//      The comparables lane declares `governmentVerificationPerformed` and a
//      REQUIRED acceptance check refuses any handback that reports otherwise or
//      that names a government source. The rule fails the lane rather than
//      passing quietly.

import { applyCompSourcePolicy, compSourceFamily } from './comp-source-policy.js';
import {
  candidateRowsFromPolicy,
  selectWorkingComps,
  valuationFromWorkingSet,
  workingSetToSnapshotComps,
} from './deal-intelligence-comps.js';
import {
  buildPropertyIntelligenceStrategies,
  type SubdivisionEvidenceInput,
} from './property-intelligence-strategy.js';
import { buildPropertyIntelligenceValuation } from './property-intelligence-valuation.js';
import { buildPracticalMarketMatrix, type AcreageMarketObservation } from './market-scan.js';
import { APPROVED_STRATEGIES } from './strategy-readiness.js';
import { scopeIntegrityCheck, type MissionAcceptanceCheckSpec } from './mission-acceptance.js';
import type { MissionChildSpec } from './mission-graph.js';
import type { MissionProviderPolicy } from './mission-provider-routing.js';
import type { FanOutMissionDefinition, MissionChildContext, MissionChildOutcome } from './mission-graph-runner.js';
import type {
  MissionContext,
  PropertyIntelligenceCollectors,
  SpecialistOutcome,
} from './property-intelligence-collector-types.js';
import type {
  PropertyIntelligenceSnapshot,
  SnapshotComps,
  SnapshotDueDiligenceItem,
  SnapshotEvidenceItem,
  SnapshotFact,
  SnapshotIdentity,
  SnapshotRecommendation,
  SnapshotStrategy,
  SnapshotValuation,
} from './property-intelligence-snapshot.js';
import type { SpecialistId } from './property-intelligence-specialists.js';
import type { CompRegistryCandidate, SubjectMarket } from './comp-registry.js';
import type { DealOperatorAnalysis, DealOperatorContext } from './deal-operator-analysis.js';
import type { DealIntelligenceInputPackage } from './deal-intelligence-assembly.js';
import type { ControllingLandUseAuthority } from './controlling-land-use-authority.js';
import type { CurrentZoningDetermination } from './current-zoning-determination.js';
import type { PropertyBackstory } from './property-backstory.js';
import type { SubdivisionRegulations } from './subdivision-regulations.js';
import type { PropertySubdivisionRead } from './subdivision-property-read.js';
import type { ZoningStandardsResult } from './zoning-standards-research.js';

export const DEAL_INTELLIGENCE_KIND = 'deal_intelligence';
export const DEAL_INTELLIGENCE_SCOPE = 'deal_card';

/** Mission groups. Each holds more than one lane where that is truthful, so a
 *  group is a real grouping rather than a synonym for a child key. */
export const DEAL_INTELLIGENCE_GROUPS = {
  subjectIdentity: 'subject_identity',
  officialRecord: 'official_record',
  siteConstraints: 'site_constraints',
  marketEvidence: 'market_evidence',
  retainedEvidence: 'retained_evidence',
  dealAnalysis: 'deal_analysis',
  /** Post-resolution intelligence: what the parcel has already been through,
   *  and what its controlling authority actually allows. */
  propertyHistory: 'property_history',
} as const;

/** Child keys. They double as the snapshot's specialist ids, so the operator
 *  reads ONE set of lane names across the mission panel and the snapshot. */
export const DEAL_INTELLIGENCE_CHILD_KEYS = [
  'parcel_identity',
  'government_records',
  'zoning_land_use',
  'environmental_terrain',
  'access_utilities',
  'comparables',
  'market_intelligence',
  'evidence_visuals',
  'property_backstory',
  'subdivision_feasibility',
  'valuation',
  'strategy',
] as const;

export type DealIntelligenceChildKey = (typeof DEAL_INTELLIGENCE_CHILD_KEYS)[number];

/** Every lane here runs deterministic LandOS code over persisted evidence and
 *  approved free sources. None routes to a model, so each declares that plainly
 *  instead of naming a provider it never engages. */
const DETERMINISTIC = (what: string): MissionProviderPolicy => ({
  mode: 'deterministic',
  rationale: `${what} is produced by deterministic LandOS code over retained evidence and approved sources. No model is engaged and no credit is spent.`,
});

/** Applied to every lane: a handback that names a Deal Card must name THIS one. */
const SCOPE: MissionAcceptanceCheckSpec = scopeIntegrityCheck('dealCardId');

/** Sources the comparable lane is allowed to use. Discovery-stage market
 *  evidence only — never a government record pulled on someone else's parcel. */
export const APPROVED_COMP_SOURCE_PATTERNS = [/landportal/i, /zillow/i, /redfin/i, /persisted/i, /operator/i];

/**
 * PROVIDER names that would mean a government record was pulled for a comp.
 *
 * Scope is deliberately narrow, and the narrowness matters as much as the rule:
 *
 *   • Matched ONLY against `handback.sources`, which is built from each
 *     candidate's PROVIDER name. The check never reads a comp's apn, county,
 *     sourceUrl, or any other field, so a perfectly good Zillow or Redfin row
 *     that happens to carry a parcel number or a link to a county map viewer is
 *     untouched. Incidental identifiers on a marketplace record are not
 *     government-record research.
 *   • It asks one question: did this lane go to an assessor / recorder / deed /
 *     parcel-record system to establish or corroborate a COMP's transaction?
 *     That is the Phase 5 prohibition, and nothing else here is.
 *   • It is NOT a completeness gate. A comp missing acreage, a sale date or a
 *     price is judged by the comp source policy and the valuation lane, never
 *     rejected here.
 *   • It is NOT a source-governance gate. Which marketplaces are preferred is an
 *     `expected` check below, so an unexpected provider degrades the verdict to
 *     incomplete instead of erasing the lane's whole contribution.
 */
export const FORBIDDEN_COMP_SOURCE_PATTERNS = [/assessor/i, /recorder/i, /\bdeed\b/i, /\bparcel\s*(layer|record)/i, /comptroller/i, /county\s+record/i, /\bgis\b/i, /\btax\s*roll/i];

// ── Handback shapes ─────────────────────────────────────────────────────────
// Every handback carries `dealCardId` so the scope-integrity check can refuse a
// result that belongs to another Deal Card, and a `summary` the operator reads.

export interface SubjectResearchHandback {
  dealCardId: number;
  capabilityResolution: 'RESOLVED' | 'AMBIGUOUS' | 'UNRESOLVED' | 'ERROR';
  capabilityInvocationId: string;
  identityState: SnapshotIdentity['state'];
  address: string | null;
  apn: string | null;
  county: string | null;
  state: string | null;
  owner: string | null;
  acres: number | null;
  identity: SnapshotIdentity;
  discoveryUsable: boolean;
  discoveryBasis: string | null;
  facts: SnapshotFact[];
  subjectMarket: SubjectMarket;
  subjectAcres: number | null;
  acreageConflict: boolean;
  summary: string;
}

export interface GovernmentRecordsHandback {
  dealCardId: number;
  /** Government-record research is SUBJECT-ONLY. Stated on the handback so the
   *  scope of the lane is visible, not merely intended. */
  appliesTo: 'subject_property';
  recordCount: number;
  records: SnapshotFact[];
  evidence: SnapshotEvidenceItem[];
  summary: string;
}

export interface ZoningHandback {
  dealCardId: number;
  zoningKnown: boolean;
  zoning: string | null;
  items: SnapshotDueDiligenceItem[];
  facts: SnapshotFact[];
  summary: string;
  /**
   * WHICH GOVERNMENT controls zoning and subdivision for this parcel, from
   * evidence. Null when the upgrade is not wired into this run.
   *
   * Deliberately part of the EXISTING zoning lane rather than a second zoning
   * system: "whose zoning" and "what zoning" are one question asked in order,
   * and splitting them across two lanes is how an operator ends up reading a
   * district under the wrong government's name.
   */
  controllingAuthority: ControllingLandUseAuthority | null;
  /**
   * The CURRENT district for this parcel, verified against a current
   * authoritative source — or honestly unestablished. Historical planning
   * statements travel inside it as dated references and can never populate it.
   */
  currentZoning: CurrentZoningDetermination | null;
  /** True when the district above was established from a current source. */
  currentZoningEstablished: boolean;
  /**
   * Allowed uses and dimensional standards for the established district.
   *
   * Null when the district is unresolved — an ordinance read without a district
   * produces whichever district the code printed first, which is worse than
   * nothing.
   */
  zoningStandards: ZoningStandardsResult | null;
}

export interface PropertyBackstoryHandback {
  dealCardId: number;
  eventCount: number;
  /** Documents answered from retained intelligence rather than re-fetched. */
  documentsReused: number;
  documentsRetrieved: number;
  backstory: PropertyBackstory;
  summary: string;
}

export interface SubdivisionHandback {
  dealCardId: number;
  /** Authority for the RULES, from evidence. Never assumed from geography. */
  authorityName: string | null;
  authorityDetermination: string;
  ruleCount: number;
  regulations: SubdivisionRegulations;
  propertyRead: PropertySubdivisionRead;
  /** Always false. A theoretical lot count is never an approved yield. */
  approvedYieldAsserted: false;
  summary: string;
}

export interface EnvironmentalHandback {
  dealCardId: number;
  screenedLaneCount: number;
  items: SnapshotDueDiligenceItem[];
  constraints: string[];
  summary: string;
}

export interface UtilitiesAccessHandback {
  dealCardId: number;
  accessStatus: 'public_road_proximity' | 'private_road_only' | 'no_mapped_contact' | 'unknown';
  utilitiesKnown: boolean;
  utilitiesSummary: string | null;
  items: SnapshotDueDiligenceItem[];
  summary: string;
}

export interface ComparablesHandback {
  dealCardId: number;
  sources: string[];
  candidateCount: number;
  candidates: CompRegistryCandidate[];
  duplicatesMerged: number;
  landHomeSearchProof?: {
    status: 'completed' | 'blocked' | 'unavailable' | 'not_run';
    radiusMiles: number;
    timePeriodMonths: number;
    sourcesSearched: string[];
    routesAttempted: string[];
    candidatesReviewed: number;
    qualifyingResults: number;
    exclusionReasons: Array<{ reason: string; count: number }>;
  } | null;
  /** Always false. Comps are discovery-stage market evidence; no government
   *  record is pulled for a comparable property. */
  governmentVerificationPerformed: false;
  summary: string;
}

export interface MarketPulseHandback {
  dealCardId: number;
  marketMatrix: unknown;
  marketPulse: unknown;
  marketScan?: unknown;
  marketMatrixAvailable: boolean;
  marketPulseAvailable: boolean;
  facts: SnapshotFact[];
  summary: string;
}

export interface EvidenceHandback {
  dealCardId: number;
  evidenceCount: number;
  screenshotCount: number;
  documentCount: number;
  sourceLinkCount: number;
  evidence: SnapshotEvidenceItem[];
  summary: string;
}

export interface ValuationHandback {
  dealCardId: number;
  priceable: boolean;
  valuation: SnapshotValuation;
  comps: SnapshotComps;
  acceptedSoldCount: number;
  activeListingCount: number;
  landHomeCompCount: number;
  landHomeSearchProof: ComparablesHandback['landHomeSearchProof'];
  summary: string;
}

export interface StrategyHandback {
  dealCardId: number;
  strategyCount: number;
  strategies: SnapshotStrategy[];
  recommendation: SnapshotRecommendation;
  /** Lanes that were missing when strategy ran, so the operator can see exactly
   *  which conclusions were formed without them. */
  informedBy: string[];
  missingInputs: string[];
  summary: string;
}

// ── Injected capabilities ───────────────────────────────────────────────────

export interface DealIntelligenceCapabilities {
  /** The EXISTING live collectors. Phase 5 reuses them unchanged. */
  collectors: PropertyIntelligenceCollectors;
  /** Market Matrix + Market Pulse for the subject market. */
  marketPulse?: (dealCardId: number) => Promise<{
    marketMatrix: unknown;
    marketPulse: unknown;
    marketScan?: unknown;
    facts: SnapshotFact[];
    summary: string;
  }>;
  /**
   * The Comps & Valuation Capability envelope for New Lead's valuation lane.
   *
   * Injected for the same reason the other capabilities are: the capability
   * registry, the invocation store and the route layer stay out of the mission
   * definition. What it wraps is `computeMissionCompValuation` — the shared
   * implementation below — so a wired capability and an unwired mission run the
   * identical comp selection and valuation, and New Lead never keeps a second
   * authoritative valuation path.
   */
  compsValuation?: (input: MissionCompValuationInput) => Promise<MissionCompValuationResult>;
  /** Deal-scoped CRM, retained-source-attempt, market, and visual context. */
  operatorContext?: (dealCardId: number) => Promise<DealOperatorContext>;
  /** Optional whole-card multimodal Analyst. Deterministic synthesis remains the safe fallback. */
  operatorAnalyst?: (input: {
    pkg: DealIntelligenceInputPackage;
    context: DealOperatorContext;
    previousSnapshot: PropertyIntelligenceSnapshot | null;
    generatedAt: string;
  }) => Promise<DealOperatorAnalysis>;
  /**
   * Property Backstory for the CONFIRMED subject.
   *
   * Injected rather than added to `PropertyIntelligenceCollectors` so the
   * existing collector contract — and every test double that implements it —
   * is untouched. An unwired capability makes the lane report `blocked` with
   * the reason stated, exactly as the Market Pulse lane already does.
   */
  propertyBackstory?: (input: {
    dealCardId: number;
    identity: SubjectResearchHandback;
  }) => Promise<PropertyBackstory>;
  /**
   * WHO controls land use here, and what the CURRENT district is.
   *
   * Wired into the EXISTING zoning lane, which is why it takes no backstory:
   * zoning is a required lane that valuation and strategy wait behind, and
   * ordering it after a supporting history sweep would put the whole deal on
   * hold for research that only enriches it.
   */
  landUseAuthorityAndZoning?: (input: {
    dealCardId: number;
    identity: SubjectResearchHandback;
  }) => Promise<{
    authority: ControllingLandUseAuthority;
    zoning: CurrentZoningDetermination;
    /** Null when the district is unresolved; nothing is researched then. */
    zoningStandards: ZoningStandardsResult | null;
  }>;
  /**
   * The subdivision rules and the property-specific read.
   *
   * Consumes the authority the zoning lane already established, so the
   * jurisdiction is never rediscovered, plus whatever the backstory, the
   * environmental screening and the access lane actually delivered.
   */
  subdivisionIntelligence?: (input: {
    dealCardId: number;
    identity: SubjectResearchHandback;
    authority: ControllingLandUseAuthority | null;
    zoning: CurrentZoningDetermination | null;
    backstory: PropertyBackstory | null;
    environmental: EnvironmentalHandback | null;
    access: UtilitiesAccessHandback | null;
  }) => Promise<{
    regulations: SubdivisionRegulations;
    propertyRead: PropertySubdivisionRead;
  }>;
  now?: () => string;
}

// ── Child specs ─────────────────────────────────────────────────────────────

export const DEAL_INTELLIGENCE_CHILDREN: MissionChildSpec[] = [
  {
    key: 'parcel_identity',
    label: 'Parcel and LandPortal subject research',
    purpose: 'Research the subject parcel on LandPortal and the official parcel sources, then reconcile one accepted identity: address, county, state, APN, owner and acreage.',
    role: 'required',
    dependsOn: [],
    // This required lane performs one bounded authenticated LandPortal
    // inspection and the independent public-source task graph. Real provider
    // latency can put the combined evidence-preserving work just above five
    // minutes, so allow seven while every nested provider retains its own
    // tighter deadline. Timing out this parent discards every downstream lane.
    timeoutMs: 420_000,
    group: DEAL_INTELLIGENCE_GROUPS.subjectIdentity,
    assignedRole: 'Subject parcel identity of record',
    agentKey: 'dd_bot',
    contributionSlot: 'identity',
    provider: DETERMINISTIC('The reconciled subject parcel identity'),
    acceptance: {
      requiredFields: ['capabilityResolution', 'capabilityInvocationId', 'identityState', 'identity.state', 'identity.explanation'],
      checks: [
        SCOPE,
        {
          id: 'capability_subject_resolved',
          requirement: 'The Property Resolution Capability released one canonical subject.',
          severity: 'required',
          evaluate: (handback) => {
            const status = (handback as Partial<SubjectResearchHandback>).capabilityResolution;
            return {
              passed: status === 'RESOLVED',
              detail: status === 'RESOLVED'
                ? 'Property Resolution released one canonical subject.'
                : `Property Resolution returned ${status ?? 'no status'}; downstream property research is blocked.`,
            };
          },
        },
        {
          id: 'parcel_named',
          requirement: 'The identity names the subject parcel by address or APN.',
          severity: 'required',
          evaluate: (handback) => {
            const row = handback as Partial<SubjectResearchHandback>;
            const named = [row.address, row.apn].filter((value) => typeof value === 'string' && value.trim().length > 0);
            return {
              passed: named.length > 0,
              detail: named.length > 0
                ? `Named by ${named.join(' / ')}.`
                : 'Neither an address nor an APN is carried, so no parcel is named.',
            };
          },
        },
        {
          id: 'identity_confirmed',
          requirement: 'The subject parcel identity is confirmed against an official record.',
          severity: 'expected',
          evaluate: (handback) => {
            const state = (handback as Partial<SubjectResearchHandback>).identityState;
            return {
              passed: state === 'confirmed',
              detail: state === 'confirmed'
                ? 'Confirmed against an official parcel record.'
                : `Identity is "${String(state)}", so parcel-specific conclusions stay qualified.`,
            };
          },
        },
      ],
      expectedFields: ['county', 'state'],
    },
  },
  {
    key: 'government_records',
    label: 'Government records (subject property)',
    purpose: 'Retrieve the recorded assessor, deed, ownership, legal-description and tax evidence for the SUBJECT parcel only, at discovery-stage depth.',
    role: 'supporting',
    dependsOn: ['parcel_identity'],
    timeoutMs: 300_000,
    group: DEAL_INTELLIGENCE_GROUPS.officialRecord,
    assignedRole: 'Recorded government evidence for the subject parcel',
    agentKey: 'dd_bot',
    contributionSlot: 'government_records',
    provider: DETERMINISTIC('Recorded government evidence for the subject parcel'),
    acceptance: {
      requiredFields: ['appliesTo', 'recordCount'],
      checks: [
        SCOPE,
        {
          id: 'subject_only',
          requirement: 'Government-record research covers the SUBJECT property only.',
          severity: 'required',
          evaluate: (handback) => {
            const scope = (handback as Partial<GovernmentRecordsHandback>).appliesTo;
            return {
              passed: scope === 'subject_property',
              detail: scope === 'subject_property'
                ? 'Scoped to the subject parcel.'
                : `The lane reports its scope as "${String(scope)}"; only subject-property government research is permitted.`,
            };
          },
        },
        {
          id: 'records_present',
          requirement: 'At least one recorded fact was retrieved for the subject parcel.',
          severity: 'expected',
          evaluate: (handback) => {
            const count = Number((handback as Partial<GovernmentRecordsHandback>).recordCount ?? 0);
            return {
              passed: count > 0,
              detail: count > 0
                ? `${count} recorded fact(s) retrieved.`
                : 'No recorded fact was retrieved, so nothing is asserted from the official record.',
            };
          },
        },
      ],
    },
  },
  {
    key: 'zoning_land_use',
    label: 'Zoning',
    purpose: 'Establish the governing zoning district, overlays and the development rules that decide what may be built.',
    role: 'required',
    dependsOn: ['parcel_identity'],
    timeoutMs: 240_000,
    group: DEAL_INTELLIGENCE_GROUPS.siteConstraints,
    assignedRole: 'Zoning and land-use determination',
    agentKey: 'dd_bot',
    contributionSlot: 'zoning',
    provider: DETERMINISTIC('The governing zoning determination'),
    acceptance: {
      // `zoningKnown` may legitimately be false. What the lane must deliver is a
      // STATED answer, never a particular one: "not established" is a real
      // discovery-stage finding, and rejecting it would push the mission to
      // invent a district it never confirmed.
      requiredFields: ['zoningKnown'],
      checks: [
        SCOPE,
        {
          id: 'zoning_stated',
          requirement: 'The lane states a zoning finding, even when the district is not established.',
          severity: 'required',
          evaluate: (handback) => {
            const row = handback as Partial<ZoningHandback>;
            const stated = typeof row.zoningKnown === 'boolean' && Array.isArray(row.items) && row.items.length > 0;
            return {
              passed: stated,
              detail: stated
                ? row.zoningKnown ? `Zoning district: ${String(row.zoning)}.` : 'Stated: the zoning district is not established from the official sources searched.'
                : 'The lane returned no zoning finding at all, so nothing is stated about zoning.',
            };
          },
        },
        {
          id: 'zoning_established',
          requirement: 'The governing zoning district is established.',
          severity: 'expected',
          evaluate: (handback) => {
            const known = (handback as Partial<ZoningHandback>).zoningKnown === true;
            return {
              passed: known,
              detail: known
                ? 'The governing district is established.'
                : 'The district is not established; conclusions that depend on zoning are qualified accordingly.',
            };
          },
        },
      ],
    },
  },
  {
    key: 'environmental_terrain',
    label: 'Environmental screening',
    purpose: 'Screen floodplain, wetlands, soils and septic suitability, slope and mapped water features against public sources.',
    role: 'required',
    dependsOn: ['parcel_identity'],
    timeoutMs: 240_000,
    group: DEAL_INTELLIGENCE_GROUPS.siteConstraints,
    assignedRole: 'Environmental and terrain screening',
    agentKey: 'dd_bot',
    contributionSlot: 'environmental',
    provider: DETERMINISTIC('The public environmental screening'),
    acceptance: {
      requiredFields: ['screenedLaneCount'],
      checks: [
        SCOPE,
        {
          id: 'screening_stated',
          requirement: 'The lane states which environmental questions it screened.',
          severity: 'required',
          evaluate: (handback) => {
            const items = (handback as Partial<EnvironmentalHandback>).items;
            return {
              passed: Array.isArray(items),
              detail: Array.isArray(items)
                ? `${items.length} environmental finding(s) stated.`
                : 'No environmental finding list was returned, so nothing is stated about the site.',
            };
          },
        },
        {
          id: 'screening_performed',
          requirement: 'At least one environmental lane was actually screened.',
          severity: 'expected',
          evaluate: (handback) => {
            const count = Number((handback as Partial<EnvironmentalHandback>).screenedLaneCount ?? 0);
            return {
              passed: count > 0,
              detail: count > 0 ? `${count} lane(s) screened.` : 'No environmental lane was screened.',
            };
          },
        },
      ],
    },
  },
  {
    key: 'access_utilities',
    label: 'Utilities and access',
    purpose: 'Determine road frontage and physical access, discoverable easements, and utility availability at discovery-stage depth.',
    role: 'required',
    dependsOn: ['parcel_identity'],
    timeoutMs: 240_000,
    group: DEAL_INTELLIGENCE_GROUPS.siteConstraints,
    assignedRole: 'Access, frontage and utility availability',
    agentKey: 'dd_bot',
    contributionSlot: 'access_utilities',
    provider: DETERMINISTIC('The access and utility screening'),
    acceptance: {
      requiredFields: ['accessStatus', 'utilitiesKnown'],
      checks: [
        SCOPE,
        {
          id: 'access_stated',
          requirement: 'The lane states an access status, including "unknown" when nothing is mapped.',
          severity: 'required',
          evaluate: (handback) => {
            const status = (handback as Partial<UtilitiesAccessHandback>).accessStatus;
            const allowed = ['public_road_proximity', 'private_road_only', 'no_mapped_contact', 'unknown'];
            return {
              passed: typeof status === 'string' && allowed.includes(status),
              detail: typeof status === 'string' && allowed.includes(status)
                ? `Access status: ${status.replace(/_/g, ' ')}.`
                : `Access status is ${String(status)}, which is not a stated finding.`,
            };
          },
        },
        {
          id: 'utilities_established',
          requirement: 'Utility availability is established.',
          severity: 'expected',
          evaluate: (handback) => {
            const known = (handback as Partial<UtilitiesAccessHandback>).utilitiesKnown === true;
            return {
              passed: known,
              detail: known ? 'Utility availability is established.' : 'Utility availability was not established at discovery stage.',
            };
          },
        },
      ],
    },
  },
  {
    key: 'comparables',
    label: 'Comparable sales and active competition',
    purpose: 'Collect vacant-land comparable sales and active competition directly from LandPortal, Zillow and Redfin.',
    role: 'required',
    // Identity is the only input this lane consumes: its executor reads the
    // parcel_identity handback and nothing else. It used to also AWAIT the
    // projection refresh, but only because both lanes drove the operator's ONE
    // Chrome working tab through a single in-process gate — ordering them was a
    // browser-capacity workaround, not a data dependency. With per-lane page
    // isolation in the browser layer, each lane holds its own page, so this
    // lane starts as soon as the subject identity settles instead of sitting
    // for up to twenty minutes behind a refresh it consumes nothing from.
    dependsOn: ['parcel_identity'],
    timeoutMs: 900_000,
    group: DEAL_INTELLIGENCE_GROUPS.marketEvidence,
    assignedRole: 'Comparable sales and active competition',
    agentKey: 'dd_bot',
    contributionSlot: 'comparables',
    provider: DETERMINISTIC('The approved comparable sources'),
    acceptance: {
      requiredFields: ['candidateCount', 'governmentVerificationPerformed'],
      checks: [
        SCOPE,
        {
          id: 'no_government_comp_verification',
          requirement: 'No assessor, recorder, deed or other government record was pulled for a comparable property.',
          severity: 'required',
          evaluate: (handback) => {
            const row = handback as Partial<ComparablesHandback>;
            if (row.governmentVerificationPerformed !== false) {
              return {
                passed: false,
                detail: 'The lane reports that government-record verification was performed on comparables. Comps are discovery-stage market evidence; that verification is out of scope and the result is not accepted.',
              };
            }
            const sources = Array.isArray(row.sources) ? row.sources : [];
            const forbidden = sources.filter((source) => FORBIDDEN_COMP_SOURCE_PATTERNS.some((pattern) => pattern.test(source)));
            return {
              passed: forbidden.length === 0,
              detail: forbidden.length === 0
                ? `Sources used: ${sources.length ? sources.join(', ') : 'none reached'}. No government record was consulted for a comparable.`
                : `Government-record source(s) named on comparables: ${forbidden.join(', ')}. That verification is out of scope for comps.`,
            };
          },
        },
        {
          id: 'approved_comp_sources',
          // EXPECTED, not required. The live comp lane also re-screens rows
          // already persisted on this card, which carry their original provider
          // name (e.g. realie, homeharvest). Those are comp data providers, not
          // government records — the rule Phase 5 actually sets is the one above.
          //
          // Rejecting the whole lane over them would throw away every real comp
          // it did collect and leave the property unpriceable, which is the
          // over-blocking Phase 5 forbids. The comp SOURCE POLICY already decides
          // which rows may price the subject and shows the rest as excluded with
          // reasons; this check reports the deviation rather than erasing the lane.
          requirement: 'Comparables are collected directly from the approved marketplaces: LandPortal, Zillow and Redfin.',
          severity: 'expected',
          evaluate: (handback) => {
            const sources = (handback as Partial<ComparablesHandback>).sources ?? [];
            const other = sources.filter((source) => !APPROVED_COMP_SOURCE_PATTERNS.some((pattern) => pattern.test(source)));
            return {
              passed: other.length === 0,
              detail: other.length === 0
                ? `Every source is an approved marketplace${sources.length ? `: ${sources.join(', ')}` : ' (no source returned a row)'}.`
                : `Also carries row(s) previously persisted on this card from ${other.join(', ')}. They are re-screened by the comp source policy and are not collected fresh from an approved marketplace.`,
            };
          },
        },
        {
          id: 'comparables_found',
          requirement: 'At least one comparable candidate was collected.',
          severity: 'expected',
          evaluate: (handback) => {
            const count = Number((handback as Partial<ComparablesHandback>).candidateCount ?? 0);
            return {
              passed: count > 0,
              detail: count > 0 ? `${count} candidate(s) collected.` : 'No comparable candidate was returned by any approved source.',
            };
          },
        },
      ],
    },
  },
  {
    key: 'market_intelligence',
    label: 'Market Pulse and Market Matrix',
    purpose: 'Assemble the Market Matrix and the Market Pulse read for the subject market.',
    role: 'supporting',
    dependsOn: ['parcel_identity'],
    timeoutMs: 240_000,
    group: DEAL_INTELLIGENCE_GROUPS.marketEvidence,
    assignedRole: 'Subject-market pulse and matrix',
    agentKey: 'market_bot',
    contributionSlot: 'market',
    provider: DETERMINISTIC('The subject-market pulse and matrix'),
    acceptance: {
      requiredFields: ['marketMatrixAvailable', 'marketPulseAvailable'],
      checks: [
        SCOPE,
        {
          id: 'market_read_stated',
          requirement: 'The lane states whether a Market Matrix and a Market Pulse exist for this market.',
          severity: 'required',
          evaluate: (handback) => {
            const row = handback as Partial<MarketPulseHandback>;
            const stated = typeof row.marketMatrixAvailable === 'boolean' && typeof row.marketPulseAvailable === 'boolean';
            return {
              passed: stated,
              detail: stated
                ? `Market Matrix ${row.marketMatrixAvailable ? 'available' : 'not available'}; Market Pulse ${row.marketPulseAvailable ? 'available' : 'not available'}.`
                : 'The lane stated no answer about market coverage.',
            };
          },
        },
        {
          id: 'market_read_present',
          requirement: 'Both the Market Matrix and the Market Pulse resolved for the subject market.',
          severity: 'expected',
          evaluate: (handback) => {
            const row = handback as Partial<MarketPulseHandback>;
            const both = row.marketMatrixAvailable === true && row.marketPulseAvailable === true;
            return {
              passed: both,
              detail: both
                ? 'Both the Market Matrix and the Market Pulse resolved.'
                : `Market coverage is partial: matrix ${row.marketMatrixAvailable ? 'yes' : 'no'}, pulse ${row.marketPulseAvailable ? 'yes' : 'no'}.`,
            };
          },
        },
      ],
    },
  },
  {
    key: 'evidence_visuals',
    label: 'Evidence and property screenshots',
    purpose: 'Gather the retained parcel screenshots, official documents and source links that support every conclusion in this run.',
    role: 'required',
    dependsOn: ['parcel_identity'],
    timeoutMs: 240_000,
    group: DEAL_INTELLIGENCE_GROUPS.retainedEvidence,
    assignedRole: 'Retained evidence and visuals',
    agentKey: 'dd_bot',
    contributionSlot: 'evidence',
    provider: DETERMINISTIC('The retained evidence trail'),
    acceptance: {
      requiredFields: ['evidenceCount'],
      checks: [
        SCOPE,
        {
          id: 'evidence_listed',
          requirement: 'The lane returns the evidence list it counted.',
          severity: 'required',
          evaluate: (handback) => {
            const row = handback as Partial<EvidenceHandback>;
            const consistent = Array.isArray(row.evidence) && row.evidence.length === Number(row.evidenceCount ?? -1);
            return {
              passed: consistent,
              detail: consistent
                ? `${row.evidence!.length} evidence item(s) listed.`
                : 'The stated evidence count does not match the returned list, so the evidence trail is not trustworthy as delivered.',
            };
          },
        },
        {
          id: 'screenshot_retained',
          requirement: 'At least one property screenshot was retained.',
          severity: 'expected',
          evaluate: (handback) => {
            const count = Number((handback as Partial<EvidenceHandback>).screenshotCount ?? 0);
            return {
              passed: count > 0,
              detail: count > 0 ? `${count} screenshot(s) retained.` : 'No property screenshot was retained by this run.',
            };
          },
        },
      ],
    },
  },
  {
    key: 'property_backstory',
    label: 'Property backstory',
    purpose: 'Assemble the public planning, development and governing-body history of THIS parcel from the official documents LandOS already holds, expanding only past what is already stored.',
    // SUPPORTING, and nothing depends on it. That is deliberate: a history
    // sweep enriches the read, and a property with no planning history is a
    // perfectly normal property. Making it required would put a deal on hold
    // over the absence of something that may simply not exist.
    role: 'supporting',
    dependsOn: ['parcel_identity'],
    timeoutMs: 240_000,
    group: DEAL_INTELLIGENCE_GROUPS.propertyHistory,
    assignedRole: 'Public development and planning history of the subject parcel',
    agentKey: 'research_bot',
    contributionSlot: 'backstory',
    provider: DETERMINISTIC('The subject parcel backstory'),
    acceptance: {
      requiredFields: ['eventCount'],
      checks: [
        SCOPE,
        {
          id: 'backstory_stated',
          requirement: 'The lane states a backstory result, including when the record carries no history.',
          severity: 'required',
          evaluate: (handback) => {
            const row = handback as Partial<PropertyBackstoryHandback>;
            const stated = typeof row.eventCount === 'number' && !!row.backstory?.summary?.narrative;
            return {
              passed: stated,
              detail: stated
                ? `${row.eventCount} subject-specific event(s) retained.`
                : 'The lane returned no backstory at all, so nothing is stated about this parcel\'s history.',
            };
          },
        },
        {
          id: 'retained_intelligence_reused',
          requirement: 'Official documents LandOS already mined were reused rather than re-fetched.',
          severity: 'expected',
          evaluate: (handback) => {
            const row = handback as Partial<PropertyBackstoryHandback>;
            const reused = Number(row.documentsReused ?? 0);
            const retrieved = Number(row.documentsRetrieved ?? 0);
            return {
              passed: reused > 0 || retrieved === 0,
              detail: reused > 0
                ? `${reused} document(s) answered from retained LandOS intelligence; ${retrieved} newly retrieved.`
                : retrieved > 0
                  ? `No stored document intelligence existed, so ${retrieved} document(s) had to be retrieved.`
                  : 'No official document intelligence exists for this parcel yet.',
            };
          },
        },
        {
          id: 'history_found',
          requirement: 'At least one subject-specific historical event was retained.',
          severity: 'expected',
          evaluate: (handback) => {
            const count = Number((handback as Partial<PropertyBackstoryHandback>).eventCount ?? 0);
            return {
              passed: count > 0,
              detail: count > 0
                ? `${count} event(s) retained.`
                : 'No public planning or development history was found for this parcel. That is an absence of record, not evidence that nothing happened.',
            };
          },
        },
      ],
    },
  },
  {
    key: 'subdivision_feasibility',
    label: 'Subdivision rules and feasibility',
    purpose: 'Retrieve the controlling authority\'s current subdivision regulations with their ordinance sections, then state what THIS tract can plausibly do and what remains unresolved.',
    role: 'supporting',
    dependsOn: ['parcel_identity'],
    // Waits, never requires. Zoning supplies the controlling authority and the
    // district; the backstory supplies any prior lot concept; environmental and
    // access supply the site facts. Every one of them may be missing, and the
    // lane still produces a real read that names what it could not take into
    // account — which is the whole point of `awaits` over `dependsOn`.
    awaits: ['zoning_land_use', 'property_backstory', 'environmental_terrain', 'access_utilities'],
    timeoutMs: 240_000,
    group: DEAL_INTELLIGENCE_GROUPS.propertyHistory,
    assignedRole: 'Subdivision regulations and property-specific feasibility',
    agentKey: 'dd_bot',
    contributionSlot: 'subdivision',
    provider: DETERMINISTIC('The controlling subdivision regulations and the property-specific read'),
    acceptance: {
      requiredFields: ['ruleCount', 'approvedYieldAsserted'],
      checks: [
        SCOPE,
        {
          id: 'no_approved_yield_claimed',
          requirement: 'A theoretical lot count is never presented as an approved yield.',
          severity: 'required',
          evaluate: (handback) => {
            const row = handback as Partial<SubdivisionHandback>;
            if (row.approvedYieldAsserted !== false) {
              return {
                passed: false,
                detail: 'The lane reports that an approved yield was asserted. Lot yield is an entitlement decision no LandOS lane may make, so the result is not accepted.',
              };
            }
            const theoretical = row.propertyRead?.theoreticalLotCount;
            const clean = !theoretical || theoretical.approvedYield === false;
            return {
              passed: clean,
              detail: clean
                ? theoretical?.value != null
                  ? `Theoretical count of ${theoretical.value} lot(s) is carried as arithmetic, explicitly not an approved yield.`
                  : 'No theoretical lot count was computed, and none is asserted.'
                : 'The property read marks its theoretical lot count as an approved yield, which no LandOS lane may do.',
            };
          },
        },
        {
          id: 'subdivision_stated',
          requirement: 'The lane states a subdivision read, including when the rules could not be retrieved.',
          severity: 'required',
          evaluate: (handback) => {
            const row = handback as Partial<SubdivisionHandback>;
            const stated = !!row.propertyRead?.likelyPath?.kind;
            return {
              passed: stated,
              detail: stated
                ? `Likely path: ${row.propertyRead!.likelyPath.kind.replace(/_/g, ' ')} (${row.propertyRead!.likelyPath.basis}).`
                : 'The lane returned no property-specific subdivision read.',
            };
          },
        },
        {
          id: 'rules_sourced',
          requirement: 'The controlling subdivision rules were retrieved with their source.',
          severity: 'expected',
          evaluate: (handback) => {
            const row = handback as Partial<SubdivisionHandback>;
            const rules = row.regulations?.rules ?? [];
            const sourced = rules.filter((rule) => !!rule.sourceUrl || !!rule.sourceLabel).length;
            return {
              passed: rules.length > 0 && sourced === rules.length,
              detail: rules.length === 0
                ? 'No subdivision rule was extracted, so nothing is asserted about what this tract may be divided into.'
                : `${sourced} of ${rules.length} rule(s) carry a named source; ${rules.filter((rule) => rule.section).length} carry an ordinance section.`,
            };
          },
        },
      ],
    },
  },
  {
    key: 'valuation',
    label: 'Valuation',
    purpose: 'Apply the comp source policy and produce a defensible value band, or state exactly why the property is not priceable.',
    role: 'required',
    // Identity is the only HARD input: without an identified parcel there is no
    // subject to value. Comparables and the constraint lanes are AWAITED — a
    // missing comp lane produces an honest "not priceable, and here is why",
    // which is a real valuation answer, not a cancelled one.
    dependsOn: ['parcel_identity'],
    awaits: ['comparables', 'environmental_terrain', 'zoning_land_use', 'access_utilities'],
    timeoutMs: 120_000,
    group: DEAL_INTELLIGENCE_GROUPS.dealAnalysis,
    assignedRole: 'Defensible value conclusion',
    agentKey: 'uw_bot',
    contributionSlot: 'valuation',
    provider: DETERMINISTIC('The value conclusion'),
    acceptance: {
      requiredFields: ['priceable', 'valuation.basis', 'valuation.confidence'],
      checks: [
        SCOPE,
        {
          id: 'value_or_reason',
          requirement: 'The lane returns either a value band or a stated reason the property is not priceable.',
          severity: 'required',
          evaluate: (handback) => {
            const row = handback as Partial<ValuationHandback>;
            if (row.priceable === true) {
              const band = row.valuation?.range;
              const usable = !!band && Number.isFinite(band.low) && Number.isFinite(band.high) && band.high >= band.low;
              return {
                passed: usable,
                detail: usable
                  ? `Value band $${band!.low.toLocaleString()}–$${band!.high.toLocaleString()}.`
                  : 'The lane reports the property as priceable but returned no usable value band.',
              };
            }
            const reason = row.valuation?.notPriceableReason;
            const stated = typeof reason === 'string' && reason.trim().length > 0;
            return {
              passed: stated,
              detail: stated
                ? `Not priceable, with the reason stated: ${reason}`
                : 'The lane reports the property as not priceable but states no reason, so the operator cannot act on it.',
            };
          },
        },
        {
          id: 'priceable',
          requirement: 'A defensible value band exists.',
          severity: 'expected',
          evaluate: (handback) => {
            const priceable = (handback as Partial<ValuationHandback>).priceable === true;
            return {
              passed: priceable,
              detail: priceable ? 'A value band was produced.' : 'No value band exists yet; the stated reason travels with the snapshot.',
            };
          },
        },
      ],
    },
  },
  {
    key: 'strategy',
    label: 'Five-strategy analysis',
    purpose: 'Evaluate the five approved LandOS strategies against the finished valuation and the research that landed, and recommend one path.',
    role: 'required',
    // Strategy WAITS for the required research and the valuation. Only the
    // valuation is a hard input: a strategy cannot be evaluated without a value
    // conclusion (priceable or not). The research lanes are awaited so strategy
    // runs last and sees everything that landed, while a single missing lane
    // qualifies the strategies it affects instead of cancelling the analysis.
    // The identity is a HARD input as well as the valuation: strategies are
    // parcel-specific, and a lane that cannot read the accepted identity would
    // fall back to "unresolved" and blame identity work on a confirmed parcel —
    // which is exactly the misleading output this dependency prevents. It costs
    // no extra ordering: valuation already depends on identity.
    dependsOn: ['valuation', 'parcel_identity'],
    // Every awaited lane here is one the strategy executor actually READS from
    // upstream (zoning, environmental, access, government records, market).
    // Comparables is NOT awaited directly: strategy consumes comp evidence only
    // through the valuation handback (accepted counts and the working set), and
    // valuation already awaits comparables, so the ordering is guaranteed
    // transitively without declaring an edge nothing consumes.
    awaits: ['government_records', 'zoning_land_use', 'environmental_terrain', 'access_utilities', 'market_intelligence'],
    timeoutMs: 120_000,
    group: DEAL_INTELLIGENCE_GROUPS.dealAnalysis,
    assignedRole: 'Five-strategy evaluation and recommendation',
    agentKey: 'research_bot',
    contributionSlot: 'strategy',
    provider: DETERMINISTIC('The five approved strategy evaluations'),
    acceptance: {
      requiredFields: ['strategyCount', 'recommendation.posture'],
      checks: [
        SCOPE,
        {
          id: 'five_approved_strategies',
          requirement: 'All five approved LandOS strategies are evaluated, and no new strategy type is introduced.',
          severity: 'required',
          evaluate: (handback) => {
            const rows = (handback as Partial<StrategyHandback>).strategies ?? [];
            const names = rows.map((row) => row.strategy);
            const missing = APPROVED_STRATEGY_NAMES.filter((name) => !names.includes(name));
            const extra = names.filter((name) => !APPROVED_STRATEGY_NAMES.includes(name));
            return {
              passed: missing.length === 0 && extra.length === 0,
              detail: missing.length === 0 && extra.length === 0
                ? `All five approved strategies evaluated: ${names.join(', ')}.`
                : `${missing.length ? `Missing: ${missing.join(', ')}. ` : ''}${extra.length ? `Unapproved strategy type(s): ${extra.join(', ')}.` : ''}`,
            };
          },
        },
        {
          id: 'recommendation_reasoned',
          requirement: 'The recommendation states why, including when no path is recommended.',
          severity: 'required',
          evaluate: (handback) => {
            const why = (handback as Partial<StrategyHandback>).recommendation?.why;
            const stated = typeof why === 'string' && why.trim().length > 0;
            return {
              passed: stated,
              detail: stated ? 'The recommendation states its reasoning.' : 'The recommendation carries no reasoning.',
            };
          },
        },
        {
          id: 'strategy_actionable',
          requirement: 'A preferred strategy is identified.',
          severity: 'expected',
          evaluate: (handback) => {
            const preferred = (handback as Partial<StrategyHandback>).recommendation?.preferredStrategy;
            const named = typeof preferred === 'string' && preferred.trim().length > 0;
            return {
              passed: named,
              detail: named ? `Preferred path: ${preferred}.` : 'No strategy is applicable yet on what has been established.',
            };
          },
        },
      ],
    },
  },
];

/**
 * The five approved strategies, bound to the EXISTING canonical list rather than
 * re-declared here. Phase 5 adds none and removes none, and a copy of the list
 * would be free to drift from the one the rest of LandOS enforces.
 *
 * The owner-approved names are canonical, including "Quick Flip".
 */
export const APPROVED_STRATEGY_NAMES: readonly string[] = APPROVED_STRATEGIES;

const CHILD_BY_KEY = new Map(DEAL_INTELLIGENCE_CHILDREN.map((spec) => [spec.key, spec]));

export function dealIntelligenceChildSpec(key: string): MissionChildSpec {
  const spec = CHILD_BY_KEY.get(key);
  if (!spec) throw new Error(`Unknown Deal Intelligence child mission: ${key}`);
  return spec;
}

// ── Executors ───────────────────────────────────────────────────────────────

const dealScoped = (ctx: MissionChildContext): MissionContext => ({
  dealCardId: ctx.scopeId,
  runId: ctx.missionId,
  identity: null,
  comparables: null,
});

/** Read an upstream handback the runner already validated as contributing. */
function upstream<T>(ctx: MissionChildContext, key: DealIntelligenceChildKey): T | null {
  const value = ctx.upstream[key];
  return value && typeof value === 'object' ? (value as T) : null;
}

/**
 * Map a collector outcome onto a child outcome.
 *
 * A collector that reports `blocked` stays blocked: the child's own status must
 * say what actually happened. The parent join is what decides whether that gap
 * matters, and `awaits` is what stops it from cancelling unrelated lanes.
 */
function childStatusFor(outcome: SpecialistOutcome<unknown>): MissionChildOutcome['status'] {
  return outcome.status;
}

function practicalMarketObservations(candidates: CompRegistryCandidate[]): AcreageMarketObservation[] {
  return candidates.flatMap((candidate) => {
    if ((candidate.lane !== 'sold' && candidate.lane !== 'active')
      || typeof candidate.acres !== 'number' || candidate.acres <= 0
      || typeof candidate.price !== 'number' || candidate.price <= 0) return [];
    return [{
      status: candidate.lane,
      acres: candidate.acres,
      price: candidate.price,
      dateIso: candidate.saleOrListDate ?? null,
      daysOnMarket: candidate.daysOnMarket ?? null,
      source: candidate.provider,
    }];
  });
}

function subdivisionEvidenceFrom(input: {
  acres: number | null;
  government: SnapshotFact[];
  zoning: SnapshotFact[];
  dueDiligence: SnapshotDueDiligenceItem[];
}): SubdivisionEvidenceInput | null {
  if (input.acres == null || input.acres < 5) return null;
  const rows = [
    ...input.government.map((fact) => `${fact.label}: ${fact.value ?? ''}. ${fact.note ?? ''}`),
    ...input.zoning.map((fact) => `${fact.label}: ${fact.value ?? ''}. ${fact.note ?? ''}`),
    ...input.dueDiligence.map((item) => `${item.label}: ${item.headline}. ${item.detail ?? ''}`),
  ];
  const first = (pattern: RegExp): string | null => rows.find((row) => pattern.test(row)) ?? null;
  const roadText = first(/frontage|road connection|road neck|access/i);
  const observedRoadNeckFeet = roadText
    ? Number(roadText.match(/([\d,.]+)\s*(?:ft|feet|foot)\b/i)?.[1]?.replace(/,/g, '') ?? NaN)
    : NaN;
  const narrow = Number.isFinite(observedRoadNeckFeet) && observedRoadNeckFeet < 200;
  const legalPositive = rows.some((row) => /(?:legal|approved|permitted).{0,35}(?:multi(?:ple)? lots?|shared access|private road)/i.test(row));
  const physicalPositive = rows.some((row) => /(?:physical|adequate|sufficient).{0,35}(?:multi(?:ple)? lots?|shared access|private road)/i.test(row));
  return {
    governingJurisdiction: first(/jurisdiction|planning authority/i),
    minimumLotSize: first(/minimum lot|min\.? lot|lot size/i),
    minimumFrontage: first(/minimum frontage|minimum lot width/i),
    minorSubdivisionThreshold: first(/minor subdivision|minor split|administrative split/i),
    flagLotRules: first(/flag lot/i),
    sharedAccessRules: first(/shared access|shared driveway/i),
    privateRoadStandards: first(/private road|road standard/i),
    legalMultiLotAccess: legalPositive ? true : null,
    physicalMultiLotAccess: narrow ? false : physicalPositive ? true : null,
    observedRoadNeckFeet: Number.isFinite(observedRoadNeckFeet) ? observedRoadNeckFeet : null,
    concepts: [],
  };
}

/** What New Lead's valuation lane reads. Exactly the upstream handbacks it had. */
export interface MissionCompValuationInput {
  dealCardId: number;
  identity: SubjectResearchHandback | null;
  comparables: ComparablesHandback | null;
  environmental: EnvironmentalHandback | null;
  zoning: ZoningHandback | null;
  access: UtilitiesAccessHandback | null;
}

/** What it produces. The `ValuationHandback` fields the lane derives from comps. */
export interface MissionCompValuationResult {
  valuation: SnapshotValuation;
  comps: SnapshotComps;
  acceptedSoldCount: number;
  activeListingCount: number;
  landHomeCompCount: number;
  landHomeSearchProof: ComparablesHandback['landHomeSearchProof'];
}

/**
 * New Lead's comp-derived valuation, unchanged and in one place.
 *
 * This is the SAME source-policy → working-set → valuation implementation the
 * valuation lane has always run; it was lifted out of the lane body so the
 * Comps & Valuation Capability can execute it rather than a second copy of it.
 * Pure: no I/O, no persistence, no provider work.
 */
export function computeMissionCompValuation(input: MissionCompValuationInput): MissionCompValuationResult {
  const { identity, comparables, environmental, zoning, access } = input;
  const subjectMarket: SubjectMarket = identity?.subjectMarket ?? {};
  const policy = applyCompSourcePolicy(subjectMarket, comparables?.candidates ?? []);
  const dueDiligence = [...(zoning?.items ?? []), ...(environmental?.items ?? []), ...(access?.items ?? [])];

  // ── The ONE operator-facing comp result ─────────────────────────────
  //
  // The source policy says which providers may speak. The working set says
  // which ROWS the operator reads: at most five closed sales and five active
  // competitors, deduplicated across providers, with everything else counted
  // as evidence with a reason. The valuation is then derived from that same
  // set, so the conclusion on the page can never disagree with the comps
  // shown beside it.
  const subjectSelection = {
    acres: identity?.subjectAcres ?? subjectMarket.acres ?? null,
    locality: subjectMarket.locality ?? null,
    county: subjectMarket.county ?? null,
    address: identity?.address ?? identity?.identity.situs ?? identity?.identity.normalizedAddress ?? null,
    apn: identity?.apn ?? identity?.identity.apn ?? null,
  };
  const workingSet = selectWorkingComps({
    subject: subjectSelection,
    rows: candidateRowsFromPolicy(policy),
    nowMs: Date.now(),
    sourceCaps: policy.plan.caps,
  });
  const comps = workingSetToSnapshotComps(workingSet, {
    policyExplanation: policy.plan.explanation,
    landPortalUsable: policy.plan.landPortalUsable,
    landPortalRowsSeen: policy.plan.landPortalRowsSeen,
    caps: policy.plan.caps,
  });
  comps.landHomeSearchProof = comparables?.landHomeSearchProof ?? null;

  // Identity and hard due-diligence gates still outrank the comp evidence:
  // an unresolved parcel is never priced, however good the comps look.
  const gated = buildPropertyIntelligenceValuation({
    identityState: identity?.identity.state ?? 'unresolved',
    discoveryIdentityUsable: identity?.discoveryUsable ?? false,
    identityBasis: identity?.discoveryBasis ?? null,
    subjectAcres: identity?.subjectAcres ?? null,
    acreageConflict: identity?.acreageConflict ?? false,
    policy,
    constraints: environmental?.constraints ?? [],
    hardRisks: dueDiligence.filter((item) => item.verdict === 'risk').map((item) => `${item.label}: ${item.headline}`),
  });
  const hardRisks = dueDiligence
    .filter((item) => item.verdict === 'risk')
    .map((item) => `${item.label}: ${item.headline}`);
  const fromComps = valuationFromWorkingSet(subjectSelection, workingSet, {
    constraints: environmental?.constraints ?? [],
    hardRisks,
    identityState: identity?.identity.state ?? 'unresolved',
    discoveryIdentityUsable: identity?.discoveryUsable ?? false,
    identityBasis: identity?.discoveryBasis ?? null,
  });
  // A HARD gate — unconfirmed identity, unknown or contradicted subject
  // acreage — is about the SUBJECT, not the comps, and its refusal always
  // stands. Everything else is a comp question, and the working set the
  // operator is reading is what answers it. Letting the old comp-count gate
  // also veto is what produced a page saying "not priceable" above a list of
  // qualified sales.
  const subjectAcresKnown = (identity?.subjectAcres ?? 0) > 0;
  const identityState = identity?.identity.state ?? 'unresolved';
  const usableDiscoveryIdentity = identityState === 'confirmed'
    || (identityState === 'provisional' && identity?.discoveryUsable === true);
  const hardGate = !usableDiscoveryIdentity
    || !subjectAcresKnown
    || identity?.acreageConflict === true;
  const valuation: SnapshotValuation = hardGate
    ? gated
    : fromComps;

  return {
    valuation,
    comps,
    acceptedSoldCount: workingSet.sold.length,
    activeListingCount: workingSet.active.length,
    landHomeCompCount: workingSet.landHomeOnly.length,
    landHomeSearchProof: comparables?.landHomeSearchProof ?? null,
  };
}

export function dealIntelligenceExecutors(
  capabilities: DealIntelligenceCapabilities,
): Record<string, (ctx: MissionChildContext) => Promise<MissionChildOutcome>> {
  const { collectors } = capabilities;

  return {
    // ── Parcel and LandPortal subject research ────────────────────────────
    // Resolves the subject parcel against the official sources and the
    // authenticated LandPortal record. This is the mission's root lane, so it
    // does ONLY the work the rest of the mission genuinely needs.
    parcel_identity: async (ctx) => {
      const outcome = await collectors.parcel_identity(dealScoped(ctx));
      const data = outcome.data;
      if (!data || data.capabilityResolution !== 'RESOLVED') {
        return { status: 'blocked', summary: outcome.summary };
      }
      const identity = data.identity;
      const handback: SubjectResearchHandback = {
        dealCardId: ctx.scopeId,
        capabilityResolution: data.capabilityResolution,
        capabilityInvocationId: data.capabilityInvocationId,
        identityState: identity.state,
        address: identity.normalizedAddress ?? identity.situs,
        apn: identity.apn,
        county: identity.county,
        state: identity.state_,
        owner: identity.owner,
        acres: identity.acres,
        identity,
        discoveryUsable: data.discoveryUsable ?? identity.discoveryUsable ?? false,
        discoveryBasis: data.discoveryBasis ?? identity.discoveryBasis ?? null,
        facts: data.facts,
        subjectMarket: data.subjectMarket,
        subjectAcres: data.subjectAcres,
        acreageConflict: data.acreageConflict,
        summary: outcome.summary,
      };
      return { status: childStatusFor(outcome), summary: handback.summary, result: handback };
    },

    // ── Deal Card projection refresh (supporting) ─────────────────────────
    // The existing report workflow, reused as a capability. It is the slowest
    // thing in the mission and it feeds only secondary projections, so it runs
    // beside the research lanes and can never hold the mission up.
    // ── Government records (subject property only) ────────────────────────
    government_records: async (ctx) => {
      const outcome = await collectors.government_records(dealScoped(ctx));
      const retrievedRecords = (outcome.data?.records ?? []).filter((record) =>
        record.grade !== 'unresolved_question' && record.grade !== 'unavailable_public_record');
      const handback: GovernmentRecordsHandback = {
        dealCardId: ctx.scopeId,
        appliesTo: 'subject_property',
        // Placeholder rows such as "not searched" and "missing" describe a
        // limitation; they are not retrieved government facts.
        recordCount: retrievedRecords.length,
        records: outcome.data?.records ?? [],
        evidence: outcome.evidence ?? [],
        summary: outcome.summary,
      };
      return { status: childStatusFor(outcome), summary: outcome.summary, result: handback };
    },

    // ── Zoning: whose, then what ──────────────────────────────────────────
    //
    // The existing collector still runs and still produces the operator's
    // zoning cards; it is not replaced. What is added is the question that
    // logically comes first — which government controls land use here — and a
    // CURRENT district verified against a current authoritative source. The
    // two run CONCURRENTLY because the retained-snapshot collector reads
    // storage and the authority chain reads the government's own sources;
    // neither needs the other's answer.
    zoning_land_use: async (ctx) => {
      const identity = upstream<SubjectResearchHandback>(ctx, 'parcel_identity');
      const [outcome, upgrade] = await Promise.all([
        collectors.zoning_land_use(dealScoped(ctx)),
        capabilities.landUseAuthorityAndZoning && identity
          ? capabilities.landUseAuthorityAndZoning({ dealCardId: ctx.scopeId, identity }).catch(() => null)
          : Promise.resolve(null),
      ]);
      const data = outcome.data;
      const currentZoning = upgrade?.zoning ?? null;
      const authority = upgrade?.authority ?? null;
      const zoningStandards = upgrade?.zoningStandards ?? null;

      // The upgraded determination may establish a district the retained
      // snapshot never had. It may NOT erase one: a lane fills, it does not
      // overwrite an accepted value, which is the same rule the resolver's
      // `applyLaneEvidence` enforces on identity.
      const zoning = data?.zoning ?? currentZoning?.districtCode ?? null;
      const zoningKnown = (data?.zoningKnown ?? false) || currentZoning?.established === true;

      const facts: SnapshotFact[] = [...(data?.facts ?? [])];
      const now = capabilities.now?.() ?? new Date().toISOString();
      if (authority?.zoningAuthority.name) {
        facts.push({
          key: 'controlling_zoning_authority',
          label: 'Controlling zoning authority',
          value: `${authority.zoningAuthority.name} (${authority.zoningAuthority.level.replace(/_/g, ' ')})`,
          grade: authority.zoningAuthority.determination === 'confirmed' ? 'confirmed_fact' : 'likely_indication',
          source: authority.zoningAuthority.sources[0]?.label ?? 'Official government source',
          sourceUrl: authority.zoningAuthority.sources[0]?.url ?? null,
          retrievedAt: authority.verifiedAt,
          note: authority.zoningAuthority.basis,
        });
      }
      if (authority?.subdivisionAuthority.name) {
        facts.push({
          key: 'controlling_subdivision_authority',
          label: 'Controlling subdivision authority',
          value: `${authority.subdivisionAuthority.name} (${authority.subdivisionAuthority.level.replace(/_/g, ' ')})`,
          grade: authority.subdivisionAuthority.determination === 'confirmed' ? 'confirmed_fact' : 'likely_indication',
          source: authority.subdivisionAuthority.sources[0]?.label ?? 'Official government source',
          sourceUrl: authority.subdivisionAuthority.sources[0]?.url ?? null,
          retrievedAt: authority.verifiedAt,
          note: authority.subdivisionAuthority.basis,
        });
      }
      if (currentZoning?.established && currentZoning.districtCode) {
        facts.push({
          key: 'current_zoning_district',
          label: 'Current zoning district',
          value: [currentZoning.districtCode, currentZoning.districtName].filter(Boolean).join(' — '),
          grade: currentZoning.confidence === 'confirmed' ? 'confirmed_fact' : 'likely_indication',
          source: currentZoning.sourceLabel ?? 'Official zoning source',
          sourceUrl: currentZoning.sourceUrl,
          retrievedAt: currentZoning.verifiedAt,
          note: `Matched to this parcel by ${currentZoning.parcelMatchBasis}.`,
        });
      }
      if (zoningStandards?.established) {
        for (const [label, value] of [
          ['Minimum lot size', zoningStandards.standards.minimumLotSize],
          ['Minimum frontage', zoningStandards.standards.frontage],
          ['Density', zoningStandards.standards.density],
        ] as const) {
          if (!value) continue;
          const source = zoningStandards.standards.sources[0];
          facts.push({
            key: `zoning_standard_${label.toLowerCase().replace(/\s+/g, '_')}`,
            label: `${label} (${zoningStandards.districtCode})`,
            value,
            grade: 'confirmed_fact',
            source: source?.label ?? 'Adopted zoning ordinance',
            sourceUrl: source?.url ?? null,
            retrievedAt: zoningStandards.retrievedAt,
            note: source?.section ? `Per ${source.section}.` : null,
          });
        }
        const permitted = zoningStandards.allowedUses.filter((use) => use.status === 'permitted');
        if (permitted.length) {
          facts.push({
            key: 'zoning_permitted_uses',
            label: `Permitted uses (${zoningStandards.districtCode})`,
            value: permitted[0].use.slice(0, 240),
            grade: 'confirmed_fact',
            source: permitted[0].sourceLabel,
            sourceUrl: permitted[0].sourceUrl,
            retrievedAt: zoningStandards.retrievedAt,
            note: permitted[0].section ? `Per ${permitted[0].section}.` : null,
          });
        }
      }
      // Historical zoning is stated as history, never folded into the fact
      // above. A 2024 packet's "current zoning" is a 2024 statement.
      for (const reference of currentZoning?.historicalReferences ?? []) {
        if (!reference.value) continue;
        facts.push({
          key: `historical_zoning_${reference.asOf ?? 'undated'}`,
          label: 'Zoning stated in the historical planning record',
          value: reference.value,
          grade: 'likely_indication',
          source: 'Official planning document (historical)',
          sourceUrl: reference.sourceUrl,
          retrievedAt: now,
          note: `Stated as of ${reference.asOf ?? 'an undated document'}. This does NOT establish the current zoning district.`,
        });
      }

      const items = [...(data?.items ?? [])];
      if (currentZoning && !currentZoning.established) {
        items.push({
          key: 'current_zoning_verification',
          label: 'Current zoning verification',
          verdict: 'unknown',
          headline: 'The current zoning district is not established from a current authoritative source.',
          grade: 'unresolved_question',
          detail: currentZoning.limitations.join(' ') || null,
          sourceUrl: null,
          missing: [
            'A current, parcel-specific official zoning source has not been read for this parcel.',
            ...(currentZoning.historicalReferences.length
              ? ['Historical planning statements exist and were deliberately NOT used to establish current zoning.']
              : []),
          ],
        });
      }

      const handback: ZoningHandback = {
        dealCardId: ctx.scopeId,
        zoningKnown,
        zoning,
        items,
        facts,
        summary: upgrade
          ? `${outcome.summary} ${authority?.zoningAuthority.name
            ? `Controlling zoning authority: ${authority.zoningAuthority.name}.`
            : 'Controlling zoning authority is unresolved.'} ${currentZoning?.established
              ? `Current district ${currentZoning.districtCode} verified from ${currentZoning.evidenceKind?.replace(/_/g, ' ')}.`
              : 'Current district not verified from a current authoritative source.'}`.trim()
          : outcome.summary,
        controllingAuthority: authority,
        currentZoning,
        currentZoningEstablished: currentZoning?.established === true,
        zoningStandards,
      };
      // A lane that established nothing but SAID so has still delivered a real
      // discovery-stage finding. It contributes as `partial` so the gap travels
      // into the snapshot instead of the whole zoning contribution vanishing.
      const status = outcome.status === 'blocked' && handback.items.length > 0 ? 'partial' : childStatusFor(outcome);
      return { status, summary: handback.summary, result: handback };
    },

    // ── Property backstory ────────────────────────────────────────────────
    property_backstory: async (ctx) => {
      const identity = upstream<SubjectResearchHandback>(ctx, 'parcel_identity');
      if (!identity) {
        return { status: 'blocked', summary: 'No confirmed subject was handed to the backstory lane, so there is no parcel to research the history of.' };
      }
      if (!capabilities.propertyBackstory) {
        return { status: 'blocked', summary: 'No Property Backstory capability is wired into this run, so no planning or development history was assembled.' };
      }
      const backstory = await capabilities.propertyBackstory({ dealCardId: ctx.scopeId, identity });
      const handback: PropertyBackstoryHandback = {
        dealCardId: ctx.scopeId,
        eventCount: backstory.events.length,
        documentsReused: backstory.documentsReused.length,
        documentsRetrieved: backstory.documentsRetrieved.length,
        backstory,
        summary: backstory.events.length
          ? `${backstory.events.length} subject-specific planning/development event(s) retained from ${backstory.documentsReused.length + backstory.documentsRetrieved.length} official document(s); ${backstory.documentsReused.length} answered from retained LandOS intelligence.`
          : 'No public planning or development history was found for this parcel in the retained official record.',
      };
      // No history is a real finding, not a failure. It contributes as
      // `partial` so the absence travels rather than the lane reading as a gap
      // the operator has to chase.
      return { status: backstory.events.length ? 'completed' : 'partial', summary: handback.summary, result: handback };
    },

    // ── Subdivision rules and property-specific feasibility ───────────────
    subdivision_feasibility: async (ctx) => {
      const identity = upstream<SubjectResearchHandback>(ctx, 'parcel_identity');
      if (!identity) {
        return { status: 'blocked', summary: 'No confirmed subject was handed to the subdivision lane, so no parcel-specific read is possible.' };
      }
      if (!capabilities.subdivisionIntelligence) {
        return { status: 'blocked', summary: 'No subdivision intelligence capability is wired into this run, so no subdivision rules were retrieved.' };
      }
      const zoningHandback = upstream<ZoningHandback>(ctx, 'zoning_land_use');
      const backstoryHandback = upstream<PropertyBackstoryHandback>(ctx, 'property_backstory');
      const environmental = upstream<EnvironmentalHandback>(ctx, 'environmental_terrain');
      const access = upstream<UtilitiesAccessHandback>(ctx, 'access_utilities');

      const result = await capabilities.subdivisionIntelligence({
        dealCardId: ctx.scopeId,
        identity,
        authority: zoningHandback?.controllingAuthority ?? null,
        zoning: zoningHandback?.currentZoning ?? null,
        backstory: backstoryHandback?.backstory ?? null,
        environmental,
        access,
      });

      const handback: SubdivisionHandback = {
        dealCardId: ctx.scopeId,
        authorityName: result.regulations.authorityName,
        authorityDetermination: String(result.regulations.authorityDetermination),
        ruleCount: result.regulations.rules.length,
        regulations: result.regulations,
        propertyRead: result.propertyRead,
        approvedYieldAsserted: false,
        summary: `${result.regulations.rules.length} subdivision rule(s) from ${result.regulations.documents.length} document(s)`
          + `${result.regulations.authorityName ? ` for ${result.regulations.authorityName}` : ' (controlling authority unresolved)'}. `
          + `Likely path: ${result.propertyRead.likelyPath.kind.replace(/_/g, ' ')} (${result.propertyRead.likelyPath.basis}). `
          + `${result.propertyRead.theoreticalLotCount.value != null
            ? `Theoretical lot count ${result.propertyRead.theoreticalLotCount.value} — arithmetic only, not an approved yield.`
            : 'No theoretical lot count could be computed.'}`,
      };
      // A read that names what it could not establish is a real answer, and it
      // is reported as partial so the qualification travels with it.
      const complete = result.regulations.rules.length > 0 && result.propertyRead.likelyPath.basis !== 'unknown';
      return { status: complete ? 'completed' : 'partial', summary: handback.summary, result: handback };
    },

    // ── Environmental screening ───────────────────────────────────────────
    environmental_terrain: async (ctx) => {
      const outcome = await collectors.environmental_terrain(dealScoped(ctx));
      const data = outcome.data;
      const handback: EnvironmentalHandback = {
        dealCardId: ctx.scopeId,
        // Unknown cards are useful disclosure, but their presence does not
        // prove a collector ran. Live collectors supply the exact count; older
        // adapters fall back to only non-unknown findings.
        screenedLaneCount: data?.screenedLaneCount
          ?? data?.items.filter((item) => item.verdict !== 'unknown').length
          ?? 0,
        items: data?.items ?? [],
        constraints: data?.constraints ?? [],
        summary: outcome.summary,
      };
      return { status: childStatusFor(outcome), summary: outcome.summary, result: handback };
    },

    // ── Utilities and access ──────────────────────────────────────────────
    access_utilities: async (ctx) => {
      const outcome = await collectors.access_utilities(dealScoped(ctx));
      const data = outcome.data;
      const handback: UtilitiesAccessHandback = {
        dealCardId: ctx.scopeId,
        accessStatus: data?.accessStatus ?? 'unknown',
        utilitiesKnown: data?.utilitiesKnown ?? false,
        utilitiesSummary: data?.utilitiesSummary ?? null,
        items: data?.items ?? [],
        summary: outcome.summary,
      };
      return { status: childStatusFor(outcome), summary: outcome.summary, result: handback };
    },

    // ── Comparable sales (LandPortal, Zillow, Redfin — no gov verification) ─
    comparables: async (ctx) => {
      const identity = upstream<SubjectResearchHandback>(ctx, 'parcel_identity');
      const context: MissionContext = {
        ...dealScoped(ctx),
        identity: identity
          ? {
              capabilityResolution: identity.capabilityResolution,
              capabilityInvocationId: identity.capabilityInvocationId,
              identity: identity.identity,
              facts: identity.facts,
              subjectMarket: identity.subjectMarket,
              subjectAcres: identity.subjectAcres,
              acreageConflict: identity.acreageConflict,
            }
          : null,
      };
      const outcome = await collectors.comparables(context);
      // The current handback is structurally limited to the three approved
      // marketplaces. Historical disabled-provider rows remain in storage but
      // never enter mission sources, counts, snapshots, maps, or valuation.
      const candidates = (outcome.data?.candidates ?? []).filter((candidate) => {
        const family = compSourceFamily(candidate.provider);
        return family === 'landportal' || family === 'zillow' || family === 'redfin';
      });
      const sources = [...new Set(candidates.map((candidate) => candidate.provider).filter(Boolean))];
      const handback: ComparablesHandback = {
        dealCardId: ctx.scopeId,
        sources,
        candidateCount: candidates.length,
        candidates,
        duplicatesMerged: outcome.data?.duplicatesMerged ?? 0,
        landHomeSearchProof: outcome.data?.landHomeSearchProof ?? null,
        governmentVerificationPerformed: false,
        summary: outcome.summary,
      };
      return { status: childStatusFor(outcome), summary: outcome.summary, result: handback };
    },

    // ── Market Pulse and Market Matrix ────────────────────────────────────
    market_intelligence: async (ctx) => {
      const identity = upstream<SubjectResearchHandback>(ctx, 'parcel_identity');
      const comparables = upstream<ComparablesHandback>(ctx, 'comparables');
      const acreageMatrix = buildPracticalMarketMatrix({
        observations: practicalMarketObservations(comparables?.candidates ?? []),
        subjectAcres: identity?.subjectAcres ?? null,
        nowIso: capabilities.now?.() ?? new Date().toISOString(),
      });
      if (!capabilities.marketPulse) {
        const outcome = await collectors.market_intelligence(dealScoped(ctx));
        const facts = outcome.data?.facts ?? [];
        const handback: MarketPulseHandback = {
          dealCardId: ctx.scopeId,
        marketMatrix: null,
        marketPulse: null,
        marketScan: { acreageMatrix },
          marketMatrixAvailable: facts.some((fact) => fact.key === 'market_matrix'),
          marketPulseAvailable: false,
          facts,
          summary: `${outcome.summary} No Market Pulse reader is wired into this run.`.trim(),
        };
        return { status: childStatusFor(outcome), summary: handback.summary, result: handback };
      }
      const context = await capabilities.marketPulse(ctx.scopeId);
      const existingScan = context.marketScan && typeof context.marketScan === 'object'
        ? context.marketScan as Record<string, unknown>
        : {};
      const retainedAcreageMatrix = existingScan.acreageMatrix && typeof existingScan.acreageMatrix === 'object'
        ? existingScan.acreageMatrix
        : acreageMatrix;
      const handback: MarketPulseHandback = {
        dealCardId: ctx.scopeId,
        marketMatrix: context.marketMatrix ?? null,
        marketPulse: context.marketPulse ?? null,
        marketScan: { ...existingScan, acreageMatrix: retainedAcreageMatrix },
        marketMatrixAvailable: context.marketMatrix != null,
        marketPulseAvailable: context.marketPulse != null,
        facts: context.facts,
        summary: context.summary,
      };
      const status: MissionChildOutcome['status'] =
        handback.marketMatrixAvailable && handback.marketPulseAvailable ? 'completed'
          : handback.marketMatrixAvailable || handback.marketPulseAvailable ? 'partial'
            : 'blocked';
      return { status, summary: context.summary, result: handback };
    },

    // ── Evidence and property screenshots ─────────────────────────────────
    evidence_visuals: async (ctx) => {
      const outcome = await collectors.evidence_visuals(dealScoped(ctx));
      const evidence = outcome.evidence ?? [];
      const handback: EvidenceHandback = {
        dealCardId: ctx.scopeId,
        evidenceCount: evidence.length,
        screenshotCount: evidence.filter((item) => item.kind === 'screenshot' || item.kind === 'map' || item.kind === 'overlay').length,
        documentCount: evidence.filter((item) => item.kind === 'document' || item.kind === 'record').length,
        sourceLinkCount: evidence.filter((item) => item.kind === 'source_link').length,
        evidence,
        summary: outcome.summary,
      };
      return { status: childStatusFor(outcome), summary: outcome.summary, result: handback };
    },

    // ── Valuation ─────────────────────────────────────────────────────────
    valuation: async (ctx) => {
      const identity = upstream<SubjectResearchHandback>(ctx, 'parcel_identity');
      const comparables = upstream<ComparablesHandback>(ctx, 'comparables');
      const environmental = upstream<EnvironmentalHandback>(ctx, 'environmental_terrain');
      const zoning = upstream<ZoningHandback>(ctx, 'zoning_land_use');
      const access = upstream<UtilitiesAccessHandback>(ctx, 'access_utilities');

      // New Lead's comp-derived valuation runs through the Comps & Valuation
      // Capability when one is wired, and through the SAME shared computation
      // directly when it is not. Either way there is one implementation: the
      // capability executes `computeMissionCompValuation`, it never re-derives
      // a valuation of its own.
      const valuationInput: MissionCompValuationInput = {
        dealCardId: ctx.scopeId,
        identity,
        comparables,
        environmental,
        zoning,
        access,
      };
      const computed = capabilities.compsValuation
        ? await capabilities.compsValuation(valuationInput)
        : computeMissionCompValuation(valuationInput);
      const valuation = computed.valuation;

      const handback: ValuationHandback = {
        dealCardId: ctx.scopeId,
        priceable: valuation.priceable,
        valuation,
        comps: computed.comps,
        acceptedSoldCount: computed.acceptedSoldCount,
        activeListingCount: computed.activeListingCount,
        landHomeCompCount: computed.landHomeCompCount,
        landHomeSearchProof: computed.landHomeSearchProof,
        summary: valuation.priceable
          ? `Value band $${valuation.range!.low.toLocaleString()}–$${valuation.range!.high.toLocaleString()} (${valuation.confidence} confidence) from ${computed.acceptedSoldCount} selected closed sale(s) and ${computed.activeListingCount} selected active competitor(s).`
          : `Not priceable: ${valuation.notPriceableReason}`,
      };
      // A stated, defensible "not priceable" is a real valuation answer, so the
      // lane contributes as partial. It is never reported as a full result.
      return { status: valuation.priceable ? 'completed' : 'partial', summary: handback.summary, result: handback };
    },

    // ── Five-strategy analysis ────────────────────────────────────────────
    strategy: async (ctx) => {
      const identity = upstream<SubjectResearchHandback>(ctx, 'parcel_identity');
      const valuationHandback = upstream<ValuationHandback>(ctx, 'valuation');
      if (!valuationHandback) {
        return {
          status: 'blocked',
          summary: 'The valuation lane produced no result, so the five strategies cannot be evaluated against a value conclusion.',
        };
      }
      const zoning = upstream<ZoningHandback>(ctx, 'zoning_land_use');
      const environmental = upstream<EnvironmentalHandback>(ctx, 'environmental_terrain');
      const access = upstream<UtilitiesAccessHandback>(ctx, 'access_utilities');
      const government = upstream<GovernmentRecordsHandback>(ctx, 'government_records');
      const market = upstream<MarketPulseHandback>(ctx, 'market_intelligence');

      const informedBy: string[] = [];
      const missingInputs: string[] = [];
      const note = (present: unknown, label: string): void => {
        if (present) informedBy.push(label);
        else missingInputs.push(`${label} did not contribute, so any strategy that turns on it is qualified rather than asserted.`);
      };
      note(zoning, 'Zoning');
      note(environmental, 'Environmental screening');
      note(access, 'Utilities and access');
      note(government, 'Government records');
      note(market, 'Market Pulse');

      const dueDiligence = [...(zoning?.items ?? []), ...(environmental?.items ?? []), ...(access?.items ?? [])];
      const { strategies, recommendation } = buildPropertyIntelligenceStrategies({
        identityState: identity?.identity.state ?? 'unresolved',
        discoveryIdentityUsable: identity?.discoveryUsable ?? false,
        identityBasis: identity?.discoveryBasis ?? null,
        subjectAcres: identity?.subjectAcres ?? null,
        valuation: valuationHandback.valuation,
        dueDiligence,
        zoning: zoning?.zoning ?? null,
        zoningKnown: zoning?.zoningKnown ?? false,
        utilitiesKnown: access?.utilitiesKnown ?? false,
        utilitiesSummary: access?.utilitiesSummary ?? null,
        accessStatus: access?.accessStatus ?? 'unknown',
        landHomeCompCount: valuationHandback.landHomeCompCount,
        landHomeSearchProof: valuationHandback.landHomeSearchProof ?? null,
        acceptedSoldCount: valuationHandback.acceptedSoldCount,
        activeListingCount: valuationHandback.activeListingCount,
        subdivisionEvidence: subdivisionEvidenceFrom({
          acres: identity?.subjectAcres ?? null,
          government: government?.records ?? [],
          zoning: zoning?.facts ?? [],
          dueDiligence,
        }),
        // Missing research is disclosed to the strategy analysis, but it is NOT
        // passed as a mission blocker: a gap qualifies the strategies it bears
        // on, and never places the whole deal on hold.
        missionBlockers: [],
      });

      const handback: StrategyHandback = {
        dealCardId: ctx.scopeId,
        strategyCount: strategies.length,
        strategies,
        recommendation,
        informedBy,
        missingInputs,
        summary: recommendation.preferredStrategy
          ? `${strategies.length} approved strategies evaluated; recommended path: ${recommendation.preferredStrategy} (posture: ${recommendation.posture}).`
          : `${strategies.length} approved strategies evaluated; no path is applicable yet (posture: ${recommendation.posture}). ${recommendation.why}`,
      };
      // Strategy formed without every research lane is a real, usable answer —
      // reported as partial so the qualification travels with it.
      return { status: missingInputs.length === 0 ? 'completed' : 'partial', summary: handback.summary, result: handback };
    },
  };
}

/** The mission definition the route layer launches for one operator action. */
export function dealIntelligenceMissionDefinition(
  capabilities: DealIntelligenceCapabilities,
): FanOutMissionDefinition {
  return {
    kind: DEAL_INTELLIGENCE_KIND,
    label: 'Deal Intelligence',
    scope: DEAL_INTELLIGENCE_SCOPE,
    children: DEAL_INTELLIGENCE_CHILDREN,
    executors: dealIntelligenceExecutors(capabilities),
  };
}

/** Read-only view of the definition, for the SELECT-only mission read path. */
export function dealIntelligenceDefinitionShape(): Pick<FanOutMissionDefinition, 'kind' | 'scope' | 'label' | 'children'> {
  return {
    kind: DEAL_INTELLIGENCE_KIND,
    scope: DEAL_INTELLIGENCE_SCOPE,
    label: 'Deal Intelligence',
    children: DEAL_INTELLIGENCE_CHILDREN,
  };
}

/** The child key set, typed as snapshot specialist ids. */
export function dealIntelligenceSpecialistIds(): SpecialistId[] {
  return DEAL_INTELLIGENCE_CHILDREN.map((spec) => spec.key as SpecialistId);
}

/** Convenience for readers that need the snapshot type without importing it. */
export type DealIntelligenceSnapshot = PropertyIntelligenceSnapshot;
