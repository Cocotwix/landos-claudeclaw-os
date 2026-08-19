// LandOS — Utility Service Screen Capability.
//
// A PLACEMENT, not a new research engine, and deliberately the narrowest one in
// the registry. Four site-service questions become machine-screenable through
// the paths LandOS already has:
//
//   PUBLIC WATER / PUBLIC SEWER  the existing `utilities` public-intelligence
//        lane, driven off the existing official parcel lookup. County GIS,
//        service-area layers and the identified utility authority — the same
//        sources the Property Intelligence run uses, invoked once, bounded.
//
//   WELL OUTLOOK    only when public water is NOT established. A preliminary
//        acquisition screen over readily available nearby domestic-well
//        context. It never engineers a well, never predicts yield, and never
//        keeps searching for a depth number: absent readily available records,
//        the honest answer is UNKNOWN and the screen stops.
//
//   SEPTIC OUTLOOK  only when public sewer is NOT established. A preliminary
//        screen over the soil units ALREADY retained for the subject, across
//        as many mapped units as the parcel carries. It never claims a perc
//        test will pass and never replaces a soil evaluation.
//
// One invocation, one bounded official pass, no expedition. Where the ordinary
// official paths do not answer a question, this capability returns unresolved
// and says which sources it opened.

import type {
  CanonicalSubjectReference,
  CapabilityEvidenceReference,
  CapabilityExecutionEnvironment,
  CapabilityExecutionOutcome,
  CapabilityInvocationRequest,
  JsonObject,
  LandosCapability,
  SubjectResolutionState,
} from './capability-contract.js';
import { getDealCardIdForPropertyCard } from './deal-card.js';
import { attachCardActivity } from './property-card.js';
import { getLandosDb } from './db.js';
import { PublicIntelligenceStore } from './public-intelligence-store.js';
import {
  lookupOfficialParcel,
  makeLivePublicIntelligenceAdapters,
} from './public-property-intelligence-live.js';
import type {
  PublicIntelligenceSubject,
  SoilsSepticFinding,
  UtilitiesFinding,
} from './public-property-intelligence.js';
import { loadSoilsSepticScreening } from './soils-septic-outlook.js';
import { evaluateResolverIdentity, readResolverSubject } from './universal-property-resolution.js';
import {
  readPublicSewer,
  readPublicWater,
  readSepticOutlook,
  readWellOutlook,
  type PublicServiceRead,
  type RetainedSoilUnit,
  type RetainedUtilityScreen,
  type RetainedWellContext,
  type SepticLimitationRating,
} from './access-utilities-screening.js';

export const UTILITY_SERVICE_SCREEN_CAPABILITY_ID = 'utility-service-screen';

/** How long the bounded official pass gets before the screen gives up. */
const SCREEN_TIMEOUT_MS = 25_000;

export const WELL_CONTEXT_SCREENING_KIND = 'well_context_screening';

/**
 * Retain readily available nearby domestic-well context for a subject.
 *
 * Same retained-evidence path the soils screening uses. Nothing here searches:
 * a caller that already has nearby well records writes them once, and the
 * outlook is derived from them deterministically forever after.
 */
export function persistWellContextScreening(propertyCardId: number, record: RetainedWellContext): number {
  return attachCardActivity({
    cardId: propertyCardId,
    agentId: 'utility-service-screen',
    kind: WELL_CONTEXT_SCREENING_KIND,
    summary: `Nearby domestic well context retained (${record.nearbyRecordCount} record(s)).`,
    ref: JSON.stringify(record),
  });
}

export function loadWellContextScreening(propertyCardId: number): RetainedWellContext | null {
  const row = getLandosDb()
    .prepare('SELECT ref FROM landos_card_activity WHERE card_id = ? AND kind = ? ORDER BY created_at DESC, id DESC LIMIT 1')
    .get(propertyCardId, WELL_CONTEXT_SCREENING_KIND) as { ref: string } | undefined;
  if (!row?.ref) return null;
  try {
    const parsed = JSON.parse(row.ref) as RetainedWellContext;
    return typeof parsed?.nearbyRecordCount === 'number' ? parsed : null;
  } catch {
    return null;
  }
}

// ── Retained subject soils ───────────────────────────────────────────────────

function ratingOf(value: unknown): SepticLimitationRating {
  return value === 'not_limited' || value === 'somewhat_limited' || value === 'very_limited' ? value : 'unknown';
}

/**
 * Every soil unit retained for this subject, from both retained shapes: the
 * public-intelligence SSURGO finding and the operator-accepted soils screening.
 * Units are merged by name so one parcel never double-counts a unit.
 */
export function retainedSoilUnits(dealCardId: number | null, propertyCardId: number | null): RetainedSoilUnit[] {
  const units = new Map<string, RetainedSoilUnit>();
  const add = (unit: RetainedSoilUnit) => {
    const key = unit.name.trim().toLowerCase();
    if (!key || units.has(key)) return;
    units.set(key, unit);
  };

  if (dealCardId) {
    const run = new PublicIntelligenceStore().load(dealCardId)?.run;
    const finding = run?.tasks?.find((task) => task.task === 'soils_septic')?.finding;
    if (finding?.kind === 'soils_septic') {
      for (const unit of (finding as SoilsSepticFinding).mapUnits ?? []) {
        add({
          symbol: unit.symbol ?? null,
          name: unit.name,
          parcelPercentage: unit.parcelPercentage ?? null,
          approximateAcres: unit.approximateAcres ?? null,
          ratings: unit.components.map((component) => ratingOf(component.septicLimitation)),
          drainageClass: unit.components.find((component) => component.drainageClass)?.drainageClass ?? null,
          limitingFactors: [...new Set(unit.components.flatMap((component) => component.limitingFactors ?? []))],
        });
      }
    }
  }

  if (propertyCardId) {
    for (const unit of loadSoilsSepticScreening(propertyCardId)?.units ?? []) {
      add({
        symbol: unit.symbol,
        name: unit.name,
        parcelPercentage: unit.parcelSharePct,
        approximateAcres: null,
        ratings: [/very limited/i.test(unit.septicRating ?? '')
          ? 'very_limited'
          : /not limited|slight/i.test(unit.septicRating ?? '')
            ? 'not_limited'
            : /somewhat limited|moderate/i.test(unit.septicRating ?? '')
              ? 'somewhat_limited'
              : 'unknown'],
        drainageClass: unit.drainageClass,
        limitingFactors: unit.limitationReasons ?? [],
      });
    }
  }
  return [...units.values()];
}

/** The retained utilities screen for this Deal Card, when one is on record. */
export function retainedUtilityScreen(dealCardId: number | null): RetainedUtilityScreen | null {
  if (!dealCardId) return null;
  const run = new PublicIntelligenceStore().load(dealCardId)?.run;
  const task = run?.tasks?.find((entry) => entry.task === 'utilities');
  const finding = task?.finding;
  if (finding?.kind !== 'utilities') return null;
  const utilities = finding as UtilitiesFinding;
  return {
    publicWater: utilities.publicWater,
    publicSewer: utilities.publicSewer,
    researchAttempted: utilities.researchAttempted ?? [],
    screenedAt: task?.completedAt ?? null,
  };
}

// ── The bounded official pass ────────────────────────────────────────────────

export interface UtilityScreenSubject {
  propertyCardId: number | null;
  dealCardId: number | null;
  address: string | null;
  county: string | null;
  state: string | null;
  apn: string | null;
  owner: string | null;
}

export interface UtilityScreenLaneResult {
  screen: RetainedUtilityScreen | null;
  evidence: CapabilityEvidenceReference[];
  /** The official sources the pass actually tried, in their own words. */
  attempted: string[];
}

export interface UtilityServiceScreenRuntime {
  /** Injected for tests; production runs the bounded official pass below. */
  runUtilityScreen?: (subject: UtilityScreenSubject) => Promise<UtilityScreenLaneResult>;
}

/**
 * One bounded official pass: resolve the official parcel, then run the existing
 * `utilities` intelligence lane over it. Exactly one attempt at each. A parcel
 * the official adapters cannot match ends the pass — the screen says which
 * sources it tried and stops rather than widening into a search.
 */
async function runBoundedUtilityScreen(subject: UtilityScreenSubject): Promise<UtilityScreenLaneResult> {
  const lookup = await lookupOfficialParcel(
    {
      address: subject.address ?? '',
      county: subject.county ?? '',
      state: subject.state ?? '',
      apn: subject.apn ?? '',
      apnAlternates: [],
      owner: subject.owner ?? '',
    } as Parameters<typeof lookupOfficialParcel>[0],
    SCREEN_TIMEOUT_MS,
  );
  const attempted = lookup.attempted.map((attempt) => `${attempt.source} — ${attempt.note}`);
  if (!lookup.parcel) return { screen: null, evidence: [], attempted };

  const adapter = makeLivePublicIntelligenceAdapters(lookup.parcel).find((entry) => entry.task === 'utilities');
  if (!adapter) {
    return {
      screen: null,
      evidence: [],
      attempted: [...attempted, `No supported public water/sewer source is registered for ${lookup.parcel.county} County, ${lookup.parcel.state}.`],
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), adapter.timeoutMs ?? SCREEN_TIMEOUT_MS);
  const startedAt = new Date().toISOString();
  const publicSubject: PublicIntelligenceSubject = {
    rawInput: subject.address ?? subject.apn ?? '',
    normalizedAddress: lookup.parcel.address,
    county: lookup.parcel.county,
    state: lookup.parcel.state,
    resolvedApn: lookup.parcel.apn,
    resolutionStatus: 'confirmed',
    resolutionExplanation: 'Official parcel matched for the bounded utility service screen.',
  };
  try {
    const result = await adapter.run(publicSubject, {
      signal: controller.signal,
      timeoutMs: adapter.timeoutMs ?? SCREEN_TIMEOUT_MS,
      startedAt,
      captureMode: 'live',
    });
    const finding = result.finding?.kind === 'utilities' ? result.finding as UtilitiesFinding : null;
    return {
      screen: finding
        ? {
          publicWater: finding.publicWater,
          publicSewer: finding.publicSewer,
          researchAttempted: finding.researchAttempted ?? [],
          screenedAt: new Date().toISOString(),
        }
        : null,
      evidence: result.evidence.map((item) => ({
        source: item.sourceName || 'Official utility source',
        sourceUrl: item.sourceUrl ?? null,
        sourceType: 'official_county_state',
        retrievedAt: item.retrievedAt ?? startedAt,
      })),
      attempted: [...attempted, ...(finding?.researchAttempted ?? []), ...(result.failureReason ? [result.failureReason] : [])],
    };
  } catch (error) {
    return {
      screen: null,
      evidence: [],
      attempted: [...attempted, error instanceof Error ? error.message : String(error)],
    };
  } finally {
    clearTimeout(timer);
  }
}

// ── Facts ────────────────────────────────────────────────────────────────────

export interface UtilityServiceScreenFacts extends JsonObject {
  outcome: 'screened' | 'not_available';
  publicWater: { state: string; statement: string; sourcesChecked: string[] };
  publicSewer: { state: string; statement: string; sourcesChecked: string[] };
  wellOutlook: { category: string; statement: string; applicable: boolean };
  septicOutlook: {
    category: string;
    statement: string;
    applicable: boolean;
    soilUnitCount: number;
    favorableSharePct: number | null;
    limitedSharePct: number | null;
  };
  screenedAt: string | null;
}

function projectFacts(input: {
  water: PublicServiceRead;
  sewer: PublicServiceRead;
  soilUnits: RetainedSoilUnit[];
  wellContext: RetainedWellContext | null;
  screenedAt: string | null;
  screened: boolean;
}): UtilityServiceScreenFacts {
  const well = readWellOutlook(input.water, input.wellContext);
  const septic = readSepticOutlook(input.sewer, input.soilUnits);
  return {
    outcome: input.screened ? 'screened' : 'not_available',
    publicWater: { state: input.water.state, statement: input.water.statement, sourcesChecked: input.water.sourcesChecked },
    publicSewer: { state: input.sewer.state, statement: input.sewer.statement, sourcesChecked: input.sewer.sourcesChecked },
    wellOutlook: { category: well.category, statement: well.statement, applicable: well.category !== 'not_needed' },
    septicOutlook: {
      category: septic.category,
      statement: septic.statement,
      applicable: septic.category !== 'not_needed',
      soilUnitCount: input.soilUnits.length,
      favorableSharePct: septic.favorableSharePct,
      limitedSharePct: septic.limitedSharePct,
    },
    screenedAt: input.screenedAt,
  };
}

export const UTILITY_SERVICE_SCREEN_CAPABILITY: LandosCapability<UtilityServiceScreenFacts, UtilityServiceScreenRuntime> = {
  metadata: {
    id: UTILITY_SERVICE_SCREEN_CAPABILITY_ID,
    name: 'Utility Service Screen',
    contractVersion: '1.0',
    description: 'Bounded acquisition screen of public water and public sewer availability for the canonical LandOS subject, with a preliminary private-well outlook where public water is not established and a preliminary septic outlook over the retained subject soils where public sewer is not established. Screening only — never a service commitment, a yield study, or a perc-test prediction.',
  },
  validate(request: CapabilityInvocationRequest): void {
    const unsupported = Object.keys(request.parameters ?? {}).filter((key) => key !== 'lane');
    if (unsupported.length) {
      throw new Error(`Utility Service Screen does not accept caller-supplied ${unsupported.join(', ')}; service availability comes from the official source, not the caller`);
    }
    const reserved = /^(?:publicWater|publicSewer|wellOutlook|septicOutlook|percResult|facts|evidence)$/i;
    const asserts = (value: unknown): boolean => {
      if (Array.isArray(value)) return value.some(asserts);
      if (!value || typeof value !== 'object') return false;
      return Object.entries(value as Record<string, unknown>).some(([key, child]) => reserved.test(key) || asserts(child));
    };
    if (asserts(request.context ?? {})) {
      throw new Error('Utility Service Screen context cannot contain caller-supplied utility, well, or septic assertions');
    }
  },
  async execute(
    request: CapabilityInvocationRequest,
    runtime: UtilityServiceScreenRuntime,
    _environment: CapabilityExecutionEnvironment,
  ): Promise<CapabilityExecutionOutcome<UtilityServiceScreenFacts>> {
    const warnings: string[] = [];
    if (request.subject.kind !== 'canonical_property') {
      // This screen answers a question ABOUT a resolved parcel. It never
      // resolves one, and it never guesses which parcel raw input meant.
      return {
        status: 'NEEDS_INPUT',
        subjectResolution: 'UNRESOLVED',
        canonicalSubject: null,
        facts: projectFacts({
          water: readPublicWater(null),
          sewer: readPublicSewer(null),
          soilUnits: [],
          wellContext: null,
          screenedAt: null,
          screened: false,
        }),
        warnings: ['The utility service screen runs against a canonical LandOS subject. Resolve the parcel first.'],
        missingInformation: ['One canonical parcel from Property Resolution'],
      };
    }

    const propertyCardId = request.subject.propertyCardId;
    const dealCardId = request.subject.dealCardId ?? getDealCardIdForPropertyCard(propertyCardId);
    if (!dealCardId) throw new Error(`canonical property ${propertyCardId} is not linked to a Deal Card`);
    const retained = readResolverSubject(dealCardId);
    if (!retained || retained.propertyCardId !== propertyCardId || retained.entity !== request.subject.entity) {
      throw new Error(`canonical property ${propertyCardId} is not the subject of Deal Card ${dealCardId}`);
    }
    const evaluation = evaluateResolverIdentity(retained);
    const subjectResolution: SubjectResolutionState = evaluation.sufficient ? 'RESOLVED' : 'UNRESOLVED';
    const canonicalSubject: CanonicalSubjectReference = {
      kind: 'property', id: String(propertyCardId), propertyCardId, dealCardId, temporary: false,
    };

    const soilUnits = retainedSoilUnits(dealCardId, propertyCardId);
    const wellContext = loadWellContextScreening(propertyCardId);

    // `reuse` answers from the screen already on record; `refresh` — what the
    // targeted backfill always asks for — runs the one bounded official pass.
    const priorScreen = retainedUtilityScreen(dealCardId);
    const useRetainedOnly = (request.mode ?? 'reuse') === 'reuse' && priorScreen != null;
    let lane: UtilityScreenLaneResult = { screen: priorScreen, evidence: [], attempted: [] };
    if (!useRetainedOnly && subjectResolution === 'RESOLVED') {
      const run = runtime.runUtilityScreen ?? runBoundedUtilityScreen;
      lane = await run({
        propertyCardId,
        dealCardId,
        address: retained.address,
        county: retained.county,
        state: retained.state,
        apn: retained.apn,
        owner: retained.owner,
      });
      if (!lane.screen && priorScreen) lane = { ...lane, screen: priorScreen };
    }
    if (!evaluation.sufficient) {
      warnings.push('Property Resolution has not released one exact parcel for this Deal Card, so no official utility source was opened.');
      warnings.push(...evaluation.conflicts);
    }

    const screen: RetainedUtilityScreen | null = lane.screen
      ? { ...lane.screen, researchAttempted: [...new Set([...lane.screen.researchAttempted, ...lane.attempted])] }
      : lane.attempted.length
        ? { publicWater: 'unknown', publicSewer: 'unknown', researchAttempted: lane.attempted, screenedAt: new Date().toISOString() }
        : null;

    const water = readPublicWater(screen);
    const sewer = readPublicSewer(screen);
    const facts = projectFacts({
      water,
      sewer,
      soilUnits,
      wellContext,
      screenedAt: screen?.screenedAt ?? null,
      screened: screen != null,
    });

    const missingInformation: string[] = [];
    if (water.state !== 'available') missingInformation.push('Written address-level water availability from the serving utility authority');
    if (sewer.state !== 'available') missingInformation.push('Written address-level sewer availability from the serving utility authority');
    if (facts.wellOutlook.applicable && facts.wellOutlook.category === 'unknown') {
      missingInformation.push('Nearby domestic well records or local groundwater context for a well outlook');
    }
    if (facts.septicOutlook.applicable && facts.septicOutlook.category === 'unknown') {
      missingInformation.push('Mapped subject soil units for a preliminary septic screen');
    }

    return {
      status: screen ? 'SUCCEEDED' : 'NEEDS_INPUT',
      subjectResolution,
      canonicalSubject,
      facts,
      evidence: lane.evidence,
      warnings,
      missingInformation,
    };
  },
};
