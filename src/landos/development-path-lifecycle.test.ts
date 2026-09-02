// Stage 5 LIFECYCLE BEHAVIOUR: the Development Path and the Deal Brain's
// strategy comparison, over the same in-memory stand-in for the derived-
// snapshot seam that Stage 4 pins itself to.
//
//   FORMS      the completion boundary forms the path ahead of the decision,
//              and the decision names the exact path row it consumed.
//   HOLDS      an unchanged record writes nothing; an immaterial change
//              writes nothing.
//   REFRESHES  a superseding land-use product moves the path, the change is
//              named, and the decision refreshes on the `developmentPath`
//              dimension.
//   COMPARES   every exit scenario is carried with its inputs visible or
//              named missing; the seller's price is a sensitivity; return
//              metrics appear only when every input is visible; nothing is
//              auto-selected.

import { describe, expect, it } from 'vitest';

import type { PropertyFileSource } from './acquisition-intelligence-dossier.js';
import type { AcquisitionState, CommLogEntry } from './acquisitions.js';
import type { CanonicalSubjectState } from './canonical-subject-state.js';
import type { ControllingLandUseAuthority } from './controlling-land-use-authority.js';
import type { CurrentZoningDetermination } from './current-zoning-determination.js';
import { ensureDealBrainDecision, type DealBrainDecisionDeps, type RetainedDealDecision } from './deal-brain-decision.js';
import { DEAL_DECISION_SNAPSHOT, type IdentityEvidenceInput } from './deal-decision-synthesis.js';
import {
  developmentPathStatus,
  ensureDevelopmentPath,
  type DevelopmentPathDeps,
  type RetainedDevelopmentPath,
} from './development-path-lifecycle.js';
import type { MarketMatrixResolution } from './market-matrix-read.js';
import type { MarketResearchAndPulse } from './market-research-and-pulse.js';
import type { PropertyEvidenceSynthesis } from './property-evidence-synthesis.js';
import {
  ensureResearchStableIntelligence,
  type ResearchStableIntelligenceDeps,
  type RetainedReading,
} from './research-stable-intelligence.js';
import type { PropertySubdivisionRead } from './subdivision-property-read.js';
import type { SubdivisionRegulations, SubdivisionRule } from './subdivision-regulations.js';
import type { SubjectUnderstandingResult } from './subject-understanding.js';
import { ZONING_DEVELOPMENT_SNAPSHOT } from './zoning-development-intelligence.js';
import type { ZoningStandardsResult } from './zoning-standards-research.js';
import type { ZoningAnalysis } from './zoning-types.js';

const now = () => new Date('2026-09-01T00:00:00.000Z');

// ── The retained record (Deal 115 shape) ───────────────────────────────────

interface FileOptions { supportedValue?: number; askingPrice?: number | null; extraVisual?: boolean; recordedAccess?: boolean }

function file(options: FileOptions = {}): PropertyFileSource {
  return {
    dealCardId: 115, propertyCardId: 401, now,
    canonicalIdentity: { status: 'confirmed', confirmed: true },
    propertyIntelligence: {
      snapshot: { identity: { state: 'confirmed', displayAddress: '19554 NW 137th Ln', apn: '00083A03400', county: 'Bradford', city: 'Lake Butler', state_: 'FL', owner: 'HILL EUGENE W', acres: 1.5, acreageBasis: 'operator_accepted', hasParcelGeometry: true } },
      landPortalFacts: { acres: 1.5, buildability: { pct: '56.09%', acres: '0.84 ac' }, terrain: { slopeAvgPct: '1%' }, environment: { femaFloodZone: 'X', wetlandsPct: '50.14%' }, access: { landLocked: 'No', roadFrontageFt: 157.4 }, valuation: { assessedValue: '$12,000.00', totalMarketValue: '$12,000.00', taxAmount: '$210.00' } },
      access: { established: true, frontageFt: 157.4, road: 'NW 137th Lane', recordedLegalAccess: options.recordedAccess ? 'Recorded 30 ft ingress/egress easement, OR Book 412 Page 88.' : undefined, evidence: { rungs: [], outstanding: [] } },
      landUseIntelligence: { currentZoning: { established: false, statement: 'Unresolved.', references: [] } },
      compsValuation: options.supportedValue
        ? { summary: { statusLabel: 'Supported', acceptedCount: 3, fmv: { low: options.supportedValue * 0.9, central: options.supportedValue, high: options.supportedValue * 1.1 }, basisLabel: 'Accepted closed sales' }, counts: {} }
        : { summary: { statusLabel: 'Not priceable', acceptedCount: 0 }, counts: {} },
    },
    dealCard: { people: [], asking_price: options.askingPrice ?? null },
    visuals: options.extraVisual ? [{ key: 'v2', label: 'Context capture', purpose: 'context', capturedAt: '2026-08-30T00:00:00.000Z', filePath: null }] : [],
  };
}

const subject = (): CanonicalSubjectState => ({
  dealCardId: 115, propertyCardId: 401, subjectResolved: true, officiallyVerified: true,
  officialVerificationSource: 'Florida DEP statewide property-appraiser parcel layer', status: 'confirmed', source: 'identity_version',
  apn: '00083A03400', apnNormalized: '00083a03400', address: '19554 NW 137th Ln', city: 'Lake Butler', county: 'Bradford', state: 'FL', fips: '12007', zip: '32054', owner: 'HILL EUGENE W',
  subjectVersion: 'iv:137:v2#ac:1.5:operator_accepted', subjectVersionId: 137,
  governingAcreage: { value: 1.5, kind: 'operator_accepted', source: 'Operator-accepted governing acreage — Signed boundary survey held by the operator (document not yet supplied to LandOS)' },
} as unknown as CanonicalSubjectState);

const understanding = (): SubjectUnderstandingResult => ({
  dealCardId: 115, outcome: 'research_ready',
  subject: {
    apn: '00083A03400', apnNormalized: '00083a03400', apnDisplayVariants: ['00083A03400'], address: '19554 NW 137th Ln', city: 'Lake Butler', county: 'Bradford', state: 'FL', zip: '32054',
    fips: null, owner: 'HILL EUGENE W', lpPropertyId: null, lpUrl: null, legalDescription: null, acres: 1.5,
    interest: { form: 'proposed_split', statement: 'A proposed split out of the seller\'s larger holding.', excluded: [] }, provenance: {},
    verification: { researchGrade: true, officiallyVerified: true, officialVerificationSource: 'Florida DEP parcel layer', outstanding: [] },
  } as unknown as SubjectUnderstandingResult['subject'],
  candidates: [], conflicts: [], question: null, evidence: [], excludedParcels: [], confidence: 0.95, persistable: true,
  audit: { actionsUsed: 0, stopReason: 'research_ready' } as unknown as SubjectUnderstandingResult['audit'],
});

const emptyMetrics = () => ({ salesCount: null, listingCount: null, medianPrice: null, medianPricePerAcre: null, daysOnMarket: null, sellThroughRate: null, absorptionRate: null, monthsOfSupply: null, population: null, populationDensity: null, populationGrowth: null, salesDensity: null });

function marketResolver(input: { acreageBand?: string }): MarketMatrixResolution {
  const band = input.acreageBand ?? 'all';
  const carried = band === '1-2' || band === '10-20';
  return {
    matchLevel: carried ? 'county' : 'unavailable', available: carried, geography: { state: 'FL', county: 'Bradford', fips: '12007' },
    resolvedKey: carried ? 'county:12007' : null, resolvedKeyLabel: carried ? `Bradford County (${band} acres)` : null,
    acreageBandRequested: band as MarketMatrixResolution['acreageBandRequested'], acreageBandUsed: carried ? (band as MarketMatrixResolution['acreageBandUsed']) : null,
    bandFallback: null, side: 'sold', period: carried ? '2026-Q3' : null, confidence: carried ? 'high' : null,
    source: carried ? 'LandPortal Market Research' : null, provider: carried ? 'LandPortal' : null,
    staleness: { label: carried ? 'Current quarter' : 'No snapshot', quartersOld: carried ? 0 : null, isStale: false },
    facts: { pricePerAcre: null, daysOnMarket: null, sellThroughRate: null, populationGrowth: null, liquidity: null },
    metrics: carried ? { ...emptyMetrics(), salesCount: band === '1-2' ? 20 : 21, medianPricePerAcre: band === '1-2' ? 28008 : 14526, daysOnMarket: 37, sellThroughRate: 71.43, monthsOfSupply: 17.03 } : null,
    talkingPoints: [], note: carried ? 'Resolved via County match.' : 'No Market Matrix snapshot for this band.',
  };
}

// ── Land-use products, as retained ─────────────────────────────────────────

const src = (label: string, url: string, quote: string) => ({ label, url, tier: 'official_government_source' as const, quote, retrievedAt: '2026-08-31T00:00:00.000Z' });

function municipalAuthority(): ControllingLandUseAuthority {
  const assignment = { name: 'Lake Butler', level: 'municipal' as const, determination: 'confirmed' as const, basis: 'Lake Butler is named by an official government source as administering this function.', sources: [src('Planning and Zoning &#8211; City of Lake Butler', 'https://www.cityoflakebutler.com/planning-and-zoning/', 'Code of Ordinances')], competingClaims: [] };
  return { dealCardId: 115, municipality: 'Lake Butler', county: 'Bradford', state: 'FL', incorporationStatus: 'incorporated', incorporationBasis: 'An official source names a municipal government.', zoningAuthority: assignment, subdivisionAuthority: assignment, planningBody: null, geographyEvidence: null, sources: assignment.sources, conflicts: [], limitations: [], verifiedAt: '2026-08-31T00:00:00.000Z' };
}

function countyAuthority(): ControllingLandUseAuthority {
  const assignment = { name: 'Bradford County', level: 'county' as const, determination: 'confirmed' as const, basis: 'Bradford County is named by an official government source as administering this function.', sources: [src('Bradford County Zoning', 'https://bradfordcountyfl.gov/zoning', 'The Zoning Department administers the Land Development Regulations.')], competingClaims: [] };
  return { dealCardId: 115, municipality: null, county: 'Bradford', state: 'FL', incorporationStatus: 'unincorporated', incorporationBasis: 'No municipality administers land use for this parcel.', zoningAuthority: assignment, subdivisionAuthority: assignment, planningBody: 'Bradford County Planning and Zoning Board', geographyEvidence: null, sources: assignment.sources, conflicts: [], limitations: [], verifiedAt: '2026-09-02T00:00:00.000Z' };
}

const boundary = (): { analysis: Pick<ZoningAnalysis, 'jurisdiction'> } => ({
  analysis: {
    jurisdiction: { determination: 'probable', incorporationStatus: 'unincorporated_county', controllingAuthorityName: 'Bradford County', controllingAuthorityLevel: 'county', officialBoundaryEvidence: true, mailingCityDiffersFromAuthority: true, candidateAuthoritiesConsidered: [], basis: 'No official incorporated-place boundary contains the parcel geometry, so the parcel is in the unincorporated county jurisdiction.' },
  },
});

const unresolvedZoning = (): CurrentZoningDetermination => ({
  dealCardId: 115, established: false, districtCode: null, districtName: null, overlays: [], authorityName: 'Lake Butler', authorityDetermination: 'confirmed', evidenceKind: null, sourceLabel: null, sourceUrl: null, parcelMatchBasis: null, effectiveOrAsOf: null,
  verifiedAt: '2026-08-31T00:00:00.000Z', confidence: 'unresolved', conflicts: [], historicalReferences: [], requestedZoning: [],
  standards: { minimumLotSize: null, density: null, principalUses: [], residentialEligible: null, manufacturedHomeEligible: null, setbacks: null, frontage: null, lotWidth: null, heightOrCoverage: null, specialConditions: [], sources: [] },
  limitations: ['CURRENT zoning is UNRESOLVED.'], consideredEvidence: [],
} as unknown as CurrentZoningDetermination);

const establishedZoning = (): CurrentZoningDetermination => ({
  ...unresolvedZoning(), established: true, districtCode: 'RSF-1', districtName: 'Residential Single Family', authorityName: 'Bradford County', evidenceKind: 'official_zoning_gis_layer', sourceLabel: 'Bradford County zoning GIS layer', sourceUrl: 'https://gis.bradfordcountyfl.gov/zoning', parcelMatchBasis: 'Parcel polygon intersected by APN 00083A03400', effectiveOrAsOf: '2025-03-01', verifiedAt: '2026-09-02T00:00:00.000Z', confidence: 'confirmed', limitations: [],
} as unknown as CurrentZoningDetermination);

const standards = (): ZoningStandardsResult => {
  const doc = { label: 'Bradford County LDR Article 4', url: 'https://library.municode.com/fl/bradford_county/codes/ldr', draftOrProposed: false, adoptedOrAsOf: '2024-11-12' };
  return {
    dealCardId: 115, districtCode: 'RSF-1', established: true, contextOnly: false, authorityName: 'Bradford County',
    standards: { minimumLotSize: 'one (1) acre', density: null, principalUses: ['Single-family dwelling'], residentialEligible: true, manufacturedHomeEligible: true, setbacks: null, frontage: 'one hundred (100) feet', lotWidth: null, heightOrCoverage: null, specialConditions: [], sources: [{ label: doc.label, url: doc.url, section: 'Sec. 4.3.2', quote: 'Minimum lot area: one (1) acre; minimum frontage: one hundred (100) feet.' }] },
    allowedUses: [
      { use: 'Single-family detached dwelling', status: 'permitted', section: 'Sec. 4.3.1', quote: 'Permitted uses', sourceLabel: doc.label, sourceUrl: doc.url },
      { use: 'Manufactured home on a permanent foundation', status: 'special_exception', section: 'Sec. 4.3.1', quote: 'Special exceptions', sourceLabel: doc.label, sourceUrl: doc.url },
    ],
    overlays: [], documents: [doc], supersededHistory: [], conflicts: [], limitations: [], retrievedAt: '2026-09-02T00:00:00.000Z', race: null,
  };
};

const rule = (key: SubdivisionRule['key'], label: string, value: string, section: string): SubdivisionRule => ({ key, label, value, quote: value, section, sourceLabel: 'Bradford County LDR Article 6', sourceUrl: 'https://library.municode.com/fl/bradford_county/codes/ldr#art6', authorityName: 'Bradford County', effectiveOrAsOf: '2024-11-12', confidence: 'confirmed', limitations: [] });

function emptyRegulations(): SubdivisionRegulations {
  return { dealCardId: 115, authorityName: 'Lake Butler', authorityDetermination: 'confirmed', documents: [], rules: [], thresholds: { minorDefinition: null, majorDefinition: null, administrativeSplitThreshold: null, maxLotsBeforeMajorReview: null, statedMaxMinorLots: null, basis: 'Neither a minor-subdivision definition nor an explicit lot ceiling was extracted.' }, reviewSequence: [], limitations: ['No current subdivision regulation document was retrieved.'], retrievedAt: '2026-08-31T00:00:00.000Z' };
}

function retainedRegulations(): SubdivisionRegulations {
  const minor = rule('minor_subdivision_definition', 'Minor subdivision definition', 'Minor subdivision means the division of a parcel into not more than three (3) lots fronting an existing public road.', 'Sec. 6.2.1');
  const major = rule('major_subdivision_definition', 'Major subdivision definition', 'Major subdivision means any subdivision creating four (4) or more lots or a new road.', 'Sec. 6.2.2');
  return {
    dealCardId: 115, authorityName: 'Bradford County', authorityDetermination: 'confirmed',
    documents: [{ label: 'Bradford County LDR Article 6', url: 'https://library.municode.com/fl/bradford_county/codes/ldr#art6', tier: 'official_government_source', adoptedOrAsOf: '2024-11-12', draftOrProposed: false, retrievedAt: '2026-09-02T00:00:00.000Z' }],
    rules: [minor, major, rule('survey_requirement', 'Survey requirement', 'A signed and sealed boundary survey.', 'Sec. 6.4.1'), rule('plat_requirement', 'Plat requirement', 'A minor plat per Chapter 177, F.S.', 'Sec. 6.4.2'), rule('administrative_review', 'Staff / administrative review', 'Minor subdivisions are approved administratively by the Zoning Department.', 'Sec. 6.3.1')],
    thresholds: { minorDefinition: minor, majorDefinition: major, administrativeSplitThreshold: null, maxLotsBeforeMajorReview: null, statedMaxMinorLots: 3, basis: 'The regulation defines a minor subdivision as not more than three lots.' },
    reviewSequence: ['Minor plat: administrative review'], limitations: [], retrievedAt: '2026-09-02T00:00:00.000Z',
  };
}

const unknownRead = (): PropertySubdivisionRead => ({
  dealCardId: 115, likelyPath: { kind: 'unknown', basis: 'unknown', why: 'No current subdivision regulation document was retrieved for the controlling authority, so the applicable path is not established.' },
  reviewIndication: 'unknown', requiredReviewBody: null,
  theoreticalLotCount: { value: null, status: 'unknown', calculation: 'Not calculated: no minimum lot size was established from the zoning standards or the subdivision regulations.', approvedYield: false, inputs: { acres: 1.5, minimumLotAcres: null, minimumLotSizeStatedAs: null }, caveats: [] },
  frontageConstraint: { status: 'unknown', maxLotsByFrontage: null, basis: 'unknown', detail: 'No minimum frontage was established.' },
  obviousMaximumLotConstraint: { value: null, from: 'Nothing established a lot ceiling for this tract.', basis: 'unknown' },
  constraints: [{ kind: 'utilities_septic', headline: 'Utility and septic capacity is not established.', detail: '', basis: 'unknown', sources: [] }],
  nextAuthoritativeDiligence: ['Confirm the CURRENT zoning district with the controlling authority.'], limitations: [], generatedAt: '2026-08-31T00:00:00.000Z',
});

const minorRead = (): PropertySubdivisionRead => ({
  ...unknownRead(), likelyPath: { kind: 'administrative_split', basis: 'likely', why: 'A theoretical ceiling of 1 lot against the regulation\'s minor threshold of 3 places this parcel on the administrative split path.' },
  reviewIndication: 'minor', requiredReviewBody: 'Zoning Department (administrative)',
  theoreticalLotCount: { value: 1, status: 'theoretical', calculation: '1.5 ac ÷ 1 ac = 1 lot(s), floored', approvedYield: false, inputs: { acres: 1.5, minimumLotAcres: 1, minimumLotSizeStatedAs: 'one (1) acre' }, caveats: [] },
  generatedAt: '2026-09-02T00:00:00.000Z',
});

// ── A stand-in for the derived-snapshot seam ───────────────────────────────

interface StoredSnapshot { id: number; version: number; snapshotType: string; identityVersionId: number; inputHash: string; status: 'current' | 'superseded'; payload: unknown }

function seam() {
  const rows: StoredSnapshot[] = [];
  const identity = { current: 137 };
  let nextId = 1;
  let nextVersion = 1;
  const writeSnapshot: ResearchStableIntelligenceDeps['writeSnapshot'] = (input) => {
    const identityVersionId = identity.current;
    const inputHash = JSON.stringify({ identityVersionId, snapshotType: input.snapshotType, payload: input.payload });
    const existing = rows.find((row) => row.inputHash === inputHash);
    if (existing?.status === 'current') return { snapshotId: existing.id, reused: true, propertyIdentityVersionId: identityVersionId, skippedReason: null };
    if (existing) {
      const current = rows.find((row) => row.snapshotType === input.snapshotType && row.status === 'current');
      if (current && current !== existing) current.status = 'superseded';
      existing.status = 'current';
      return { snapshotId: existing.id, reused: true, reinstated: true, propertyIdentityVersionId: identityVersionId, skippedReason: null };
    }
    const prior = rows.find((row) => row.snapshotType === input.snapshotType && row.status === 'current');
    if (prior) prior.status = 'superseded';
    const row: StoredSnapshot = { id: nextId++, version: nextVersion++, snapshotType: input.snapshotType, identityVersionId, inputHash, status: 'current', payload: input.payload };
    rows.push(row);
    return { snapshotId: row.id, reused: false, propertyIdentityVersionId: identityVersionId, skippedReason: null };
  };
  const currentOf = (snapshotType: string) => rows.find((row) => row.snapshotType === snapshotType && row.status === 'current') ?? null;
  const reading = <T,>(snapshotType: string): RetainedReading<T> | null => {
    const row = currentOf(snapshotType);
    if (!row) return null;
    return { value: row.payload as T, correlation: row.identityVersionId === identity.current ? 'equivalent' : 'uncorrelated', retainedAt: '2026-09-01T00:00:00.000Z', snapshotId: row.id };
  };
  /** A land-use product retained by its own lane: a distinct row with its id. */
  const retain = (snapshotType: string, payload: unknown) => writeSnapshot({ dealCardId: 115, snapshotType, payload, completeness: {}, changeReason: 'test', actor: 'test' });
  return { rows, identity, writeSnapshot, currentOf, reading, retain, versionsOf: (snapshotType: string) => rows.filter((row) => row.snapshotType === snapshotType).length };
}

const identityEvidence = (): IdentityEvidenceInput => ({
  propertyCardId: 401, verificationStatus: 'verified_property', verificationSource: 'Florida DEP statewide property-appraiser parcel layer (Cadastral 2023)', apn: '00083A03400', county: 'Bradford', state: 'FL', fips: null,
  records: [{ recordId: 'property card 401 · source evidence #108', fact: 'Parcel identity', sourceUrl: 'https://ca.dep.state.fl.us/arcgis/rest/services/Map_Direct/Boundaries/MapServer/16/query', accessedAt: '2026-08-31T17:31:23.049Z', note: 'Official public parcel record; supports parcel identity.' }],
});

const emptyAcquisition = (): AcquisitionState => ({ dealCardId: 115, stage: 'new_lead', profile: {}, commLog: [], discovery: [], updatedAt: null });
const comm = (entry: Partial<CommLogEntry> & Pick<CommLogEntry, 'at' | 'channel' | 'direction' | 'summary'>): CommLogEntry => ({ createdAt: entry.at, ...entry });

// ── The harness ────────────────────────────────────────────────────────────

function harness(options: FileOptions = {}) {
  const store = seam();
  const state = { file: file(options), subject: subject(), acquisition: emptyAcquisition() };
  // Deal 115 as retained: a municipal authority record the official boundary
  // contradicts, unresolved zoning, no subdivision regulation, an unknown read.
  store.retain('land_use_authority_v1', municipalAuthority());
  store.retain('zoning_land_use_v1', boundary());
  store.retain('current_zoning_v1', unresolvedZoning());
  store.retain('subdivision_regulations_v1', emptyRegulations());
  store.retain('subdivision_property_read_v1', unknownRead());

  const storyDeps: ResearchStableIntelligenceDeps = { readPropertyFile: () => state.file, readSubject: () => state.subject, readUnderstanding: understanding, resolveMarket: marketResolver as never, writeSnapshot: store.writeSnapshot, now };
  const pathDeps = (cause: string): DevelopmentPathDeps => ({
    readPropertyFile: () => state.file,
    readSubject: () => state.subject,
    readPropertyStory: () => store.reading<PropertyEvidenceSynthesis>('property_evidence_synthesis_v1'),
    readAuthority: () => store.reading<ControllingLandUseAuthority>('land_use_authority_v1'),
    readBoundary: () => store.reading<{ analysis?: ZoningAnalysis }>('zoning_land_use_v1'),
    readZoning: () => store.reading<CurrentZoningDetermination>('current_zoning_v1'),
    readStandards: () => store.reading<ZoningStandardsResult>('zoning_standards_v1'),
    readRegulations: () => store.reading<SubdivisionRegulations>('subdivision_regulations_v1'),
    readSubdivisionRead: () => store.reading<PropertySubdivisionRead>('subdivision_property_read_v1'),
    readCurrent: () => store.reading<RetainedDevelopmentPath>(ZONING_DEVELOPMENT_SNAPSHOT),
    writeSnapshot: store.writeSnapshot,
    cause,
  });
  const decisionDeps = (cause: string): DealBrainDecisionDeps => ({
    readPropertyFile: () => state.file,
    readSubject: () => state.subject,
    readAcquisition: () => state.acquisition,
    readSellerStatedFacts: () => [],
    readIdentityEvidence: () => identityEvidence(),
    readPropertyStory: () => store.reading<PropertyEvidenceSynthesis>('property_evidence_synthesis_v1'),
    readMarketStory: () => store.reading<MarketResearchAndPulse>('market_research_pulse_v1'),
    readCurrentDecision: () => store.reading<RetainedDealDecision>(DEAL_DECISION_SNAPSHOT),
    readDevelopmentPath: () => store.reading<RetainedDevelopmentPath>(ZONING_DEVELOPMENT_SNAPSHOT),
    writeSnapshot: store.writeSnapshot,
    cause,
  });
  return {
    store, state,
    /** The Stage 3 completion boundary, carrying Stage 5 then Stage 4. */
    completion: (trigger = 'coverage:operator') => {
      const stories = ensureResearchStableIntelligence(115, storyDeps);
      const path = stories.property
        ? ensureDevelopmentPath(115, { ...pathDeps(trigger), propertyStory: { property: stories.property, propertySnapshotId: stories.persistence.property.snapshotId } })
        : null;
      if (!stories.property || !stories.market) return { stories, path, decision: null };
      const decision = ensureDealBrainDecision(115, {
        ...decisionDeps(trigger),
        stories: { property: stories.property, market: stories.market, propertySnapshotId: stories.persistence.property.snapshotId, marketSnapshotId: stories.persistence.market.snapshotId },
        developmentPath: path?.developmentPath ? { developmentPath: path.developmentPath, snapshotId: path.persistence.snapshotId } : null,
      });
      return { stories, path, decision };
    },
    /** A land-use capability rerun: the path over the retained products, then the decision. */
    landUseEvent: (cause = 'capability:zoning-subdivision') => {
      const path = ensureDevelopmentPath(115, pathDeps(cause));
      const decision = ensureDealBrainDecision(115, { ...decisionDeps(cause), developmentPath: path.developmentPath ? { developmentPath: path.developmentPath, snapshotId: path.persistence.snapshotId } : null });
      return { path, decision };
    },
    sellerEvent: (cause = 'seller:communication_added') => ensureDealBrainDecision(115, decisionDeps(cause)),
    currentPath: () => store.currentOf(ZONING_DEVELOPMENT_SNAPSHOT)?.payload as RetainedDevelopmentPath | undefined,
    currentDecision: () => store.currentOf(DEAL_DECISION_SNAPSHOT)?.payload as RetainedDealDecision | undefined,
  };
}

// ── 1. The completion boundary forms the path ahead of the decision ────────

describe('a settled research run forms the Development Path and the decision consumes it', () => {
  it('dismisses the postal-locality Lake Butler claim, works against the official boundary, and leaves every path not established', () => {
    const h = harness();
    const { path, decision } = h.completion();
    expect(path?.outcome).toBe('produced');
    expect(decision?.outcome).toBe('produced');
    const read = h.currentPath()!;
    expect(read.authority.conflict).toBeNull();
    expect(read.authority.nonQualifyingClaims[0].claim).toBe('Lake Butler administers zoning (municipal)');
    expect(read.authority.zoning.name).toBe('Bradford County');
    expect(read.authority.zoning.weight).toBe('well_supported');
    expect(read.authority.incorporationStatus).toBe('unincorporated');
    expect(read.paths.map((entry) => entry.applicability)).toEqual(['not_established', 'not_established', 'not_established']);
    expect(read.paths[0].decisiveVerification.action).toMatch(/Obtain the current zoning district for APN 00083A03400 from Bradford County/);
    expect(read.refresh.kind).toBe('initial');
    expect(read.basedOn.authoritySnapshotId).toBe(h.store.currentOf('land_use_authority_v1')!.id);
    expect(read.basedOn.regulationsSnapshotId).toBe(h.store.currentOf('subdivision_regulations_v1')!.id);
    expect(read.basedOn.standardsSnapshotId).toBeNull();
    expect(read.inputStatus.standards).toBe('pending');
    expect(read.inputStatus.propertyStory).toBe('current');
    expect(read.generatedAt).toBeNull();
  });

  it('the decision names the exact path row it consumed and carries its status beside the Stage 3 inputs', () => {
    const h = harness();
    h.completion();
    const decision = h.currentDecision()!;
    const path = h.store.currentOf(ZONING_DEVELOPMENT_SNAPSHOT)!;
    expect(decision.contractVersion).toBe('1.5.2');
    expect(decision.basedOn.developmentPathSnapshotId).toBe(path.id);
    expect(decision.inputs.developmentPath.product).toBe('development_path');
    expect(decision.inputs.developmentPath.status).toBe('partial_current');
    expect(decision.inputs.developmentPath.consumedByDealBrain).toBe(true);
    expect(decision.inputs.developmentPath.coverage).toMatch(/Bradford County · district not established · 0\/3 paths placed/);
    expect(decision.strategyComparison.developmentPathStatus).toBe('current');
    expect(decision.materialDimensions.developmentPath).toMatch(/^Bradford County · district not established/);
  });

  it('the strategy comparison carries every scenario with visible or missing inputs, no price, and no auto-selection', () => {
    const h = harness();
    h.completion();
    const comparison = h.currentDecision()!.strategyComparison;
    expect(comparison.scenarios.map((scenario) => scenario.id)).toEqual(['as_is_quick_flip', 'light_improvement', 'minor_subdivision', 'major_subdivision_entitlement', 'land_home_manufactured', 'novation_double_close', 'owner_finance']);
    expect(comparison.scenarios.every((scenario) => scenario.returnMetrics === null)).toBe(true);
    expect(comparison.scenarios.every((scenario) => scenario.grossExit === null)).toBe(true);
    expect(comparison.scenarios.find((scenario) => scenario.id === 'minor_subdivision')!.status).toBe('unknown');
    expect(comparison.scenarios.find((scenario) => scenario.id === 'minor_subdivision')!.nextDecisiveAction).toMatch(/Obtain Bradford County's current subdivision \/ land development regulations/);
    expect(comparison.priceSensitivity.mode).toBe('no_price');
    expect(comparison.priceSensitivity.points).toHaveLength(0);
    expect(comparison.priceSensitivity.missingInputs.join(' ')).toMatch(/fair market value|No fair market value/);
    expect(comparison.notAutoSelected).toBe(true);
    expect(comparison.statement).toMatch(/does not pick the highest gross profit/);
    expect(comparison.ranking).toHaveLength(7);
    expect(comparison.ranking[0].rank).toBe(1);
  });
});

// ── 2. Holds ───────────────────────────────────────────────────────────────

describe('the path and the decision hold still on unchanged or immaterial evidence', () => {
  it('a repeated completion writes nothing', () => {
    const h = harness();
    h.completion();
    const again = h.completion('coverage:mission');
    expect(again.path?.outcome).toBe('unchanged');
    expect(again.decision?.outcome).toBe('unchanged');
    expect(h.store.versionsOf(ZONING_DEVELOPMENT_SNAPSHOT)).toBe(1);
    expect(h.store.versionsOf(DEAL_DECISION_SNAPSHOT)).toBe(1);
  });

  it('another retained capture is immaterial to both', () => {
    const h = harness();
    h.completion();
    h.state.file = file({ extraVisual: true });
    const again = h.completion('coverage:evidence_upload');
    expect(again.path?.outcome).toBe('unchanged');
    expect(again.decision?.outcome).toBe('unchanged');
  });
});

// ── 3. Refreshes on a superseding land-use product ─────────────────────────

describe('a superseding land-use product refreshes the path and the decision, and both name what moved', () => {
  it('a county authority, an established district, standards and the local regulation move the path to a placed minor read', () => {
    const h = harness();
    h.completion();
    h.store.retain('land_use_authority_v1', countyAuthority());
    h.store.retain('current_zoning_v1', establishedZoning());
    h.store.retain('zoning_standards_v1', standards());
    h.store.retain('subdivision_regulations_v1', retainedRegulations());
    h.store.retain('subdivision_property_read_v1', minorRead());
    const { path, decision } = h.landUseEvent();

    expect(path.outcome).toBe('produced');
    const read = h.currentPath()!;
    expect(read.refresh.kind).toBe('material');
    expect(read.refresh.cause).toBe('capability:zoning-subdivision');
    const moved = read.refresh.changes.map((change) => change.dimension);
    expect(moved).toEqual(expect.arrayContaining(['authority', 'district', 'uses', 'standard.lot_area', 'minorThreshold', 'path.as_is', 'path.minor_subdivision']));
    expect(read.authority.conflict).toBeNull();
    expect(read.authority.nonQualifyingClaims).toHaveLength(0);
    expect(read.authority.zoning.weight).toBe('confirmed');
    expect(read.zoning.districtCode).toBe('RSF-1');
    expect(read.paths.find((entry) => entry.kind === 'as_is')!.applicability).toBe('applies');
    expect(read.paths.find((entry) => entry.kind === 'minor_subdivision')!.applicability).toBe('not_applicable');
    expect(read.paths.find((entry) => entry.kind === 'minor_subdivision')!.localDefinition?.definition).toMatch(/not more than three \(3\) lots/);
    expect(h.store.versionsOf(ZONING_DEVELOPMENT_SNAPSHOT)).toBe(2);

    expect(decision.outcome).toBe('produced');
    const posture = h.currentDecision()!;
    expect(posture.refresh.kind).toBe('material');
    expect(posture.refresh.changes.map((change) => change.dimension)).toEqual(expect.arrayContaining(['developmentPath', 'scenarios']));
    expect(posture.basedOn.developmentPathSnapshotId).toBe(h.store.currentOf(ZONING_DEVELOPMENT_SNAPSHOT)!.id);
    const scenarios = posture.strategyComparison.scenarios;
    expect(scenarios.find((scenario) => scenario.id === 'minor_subdivision')!.status).toBe('not_supported');
    expect(scenarios.find((scenario) => scenario.id === 'land_home_manufactured')!.status).toBe('conditional');
    expect(scenarios.find((scenario) => scenario.id === 'land_home_manufactured')!.keyApprovals[0]).toMatch(/special-exception/);
  });

  it('a land-use rerun that retains the same substance writes nothing', () => {
    const h = harness();
    h.completion();
    h.store.retain('current_zoning_v1', { ...unresolvedZoning(), verifiedAt: '2026-09-03T00:00:00.000Z', limitations: ['CURRENT zoning is UNRESOLVED. Rerun.'] });
    const { path, decision } = h.landUseEvent();
    expect(path.outcome).toBe('unchanged');
    expect(decision.outcome).toBe('unchanged');
  });
});

// ── 4. Price as a sensitivity, return metrics only when every input is visible ──

describe('the seller price is a sensitivity, never a selector', () => {
  it('with an asking price and a supported value, the as-is scenario computes its return and the sensitivity tests low, base and high', () => {
    const h = harness({ supportedValue: 40_000, askingPrice: 22_000, recordedAccess: true });
    h.completion();
    const comparison = h.currentDecision()!.strategyComparison;
    const asIs = comparison.scenarios.find((scenario) => scenario.id === 'as_is_quick_flip')!;
    // Persisted text carries whole days, never the provider's raw decimals.
    expect(asIs.buyerDemand).toMatch(/37 days on market/);
    expect(JSON.stringify(comparison)).not.toMatch(/37\.02/);
    expect(asIs.grossExit?.amount).toBe(40_000);
    expect(asIs.purchasePriceCapacity).toMatchObject({ low: 16_000, high: 24_000, lowPct: 40, highPct: 60, confirmed: true });
    expect(asIs.directCosts.map((line) => line.amount)).toEqual([2_800, 800]);
    expect(asIs.softCosts.find((line) => line.key === 'carrying')?.amount).toBe(600);
    expect(asIs.softCosts.find((line) => line.key === 'reserve')?.amount).toBe(2_000);
    // Purchase-side closing is an operator figure: still missing, so the
    // return is withheld even though the exit and the price are visible.
    expect(asIs.softCosts.find((line) => line.key === 'purchase_closing')?.amount).toBeNull();
    expect(asIs.returnMetrics).toBeNull();
    expect(asIs.missingInputs).toEqual(expect.arrayContaining(['Purchase-side closing and title cost (operator figure).']));
    expect(asIs.capitalAtRisk?.amount).toBe(22_600);
    expect(asIs.timeToExit?.statement).toMatch(/About 37 days median list-to-sale/);

    const sensitivity = comparison.priceSensitivity;
    expect(sensitivity.mode).toBe('asking_price');
    expect(sensitivity.points.map((point) => [point.label, point.price])).toEqual([['low', 18_700], ['base', 22_000], ['high', 25_300]]);
    expect(sensitivity.points[1].plausible).toContain('as_is_quick_flip');
    expect(sensitivity.points[2].exceeded).toContain('as_is_quick_flip');
    expect(sensitivity.points[2].plausible).not.toContain('as_is_quick_flip');
    expect(sensitivity.statement).toMatch(/±15% LandOS sensitivity band/);
  });

  it('a seller-stated range is tested at its low, midpoint and high, from the retained communication only', () => {
    const h = harness({ supportedValue: 40_000 });
    h.completion();
    h.state.acquisition = {
      ...emptyAcquisition(),
      commLog: [comm({ id: 'c1', type: 'text', at: '2026-09-02T15:00:00.000Z', channel: 'text', direction: 'inbound', summary: 'Seller replied by text.', body: 'We were hoping to get $20,000 to $24,000 for it. My sister has to agree too.' })],
    };
    h.sellerEvent();
    const sensitivity = h.currentDecision()!.strategyComparison.priceSensitivity;
    expect(sensitivity.mode).toBe('seller_range');
    expect(sensitivity.source).toMatch(/Seller communication/);
    expect(sensitivity.points.map((point) => point.price)).toEqual([20_000, 22_000, 24_000]);
    expect(sensitivity.points.every((point) => point.plausible.includes('as_is_quick_flip'))).toBe(true);
  });

  it('ranks by evidence status, complexity, approvals, sourced time and open inputs, and says so', () => {
    const h = harness({ supportedValue: 40_000, askingPrice: 22_000, recordedAccess: true });
    h.completion();
    const comparison = h.currentDecision()!.strategyComparison;
    expect(comparison.ranking[0].id).toBe('as_is_quick_flip');
    expect(comparison.ranking[0].why).toMatch(/conditional; low complexity/);
    expect(comparison.criteria).toContain('Capital at risk');
    expect(comparison.ranking.find((entry) => entry.id === 'major_subdivision_entitlement')!.rank).toBeGreaterThan(comparison.ranking.find((entry) => entry.id === 'minor_subdivision')!.rank);
  });
});

// ── 5. The persisted payload is correct, and an older contract is re-formed once ──

describe('the persisted payload, not the screen, carries the corrected text', () => {
  it('writes decoded source labels into the Development Path and the decision JSON', () => {
    const h = harness();
    h.completion();
    const pathJson = JSON.stringify(h.store.currentOf(ZONING_DEVELOPMENT_SNAPSHOT)!.payload);
    const decisionJson = JSON.stringify(h.store.currentOf(DEAL_DECISION_SNAPSHOT)!.payload);
    expect(pathJson).not.toMatch(/&#\d+;|&[a-z]+;/i);
    expect(decisionJson).not.toMatch(/&#\d+;|&[a-z]+;/i);
    expect(pathJson).toContain('Planning and Zoning – City of Lake Butler');
    // The retained authority record itself is untouched: it still carries the entity.
    expect(JSON.stringify(h.store.currentOf('land_use_authority_v1')!.payload)).toContain('&#8211;');
  });

  it('re-forms a current Development Path written under an older contract once, keeps the prior as history, then holds still', () => {
    const h = harness();
    h.completion();
    const current = h.store.currentOf(ZONING_DEVELOPMENT_SNAPSHOT)!;
    // Simulate the row the previous contract wrote: same material fingerprint,
    // older contract version, an undecoded label.
    const stale = JSON.parse(JSON.stringify(current.payload)) as RetainedDevelopmentPath;
    (stale as { contractVersion: string }).contractVersion = '1.0.0';
    stale.authority.nonQualifyingClaims[0].source = 'Planning and Zoning &#8211; City of Lake Butler';
    current.payload = stale;
    current.inputHash = 'stale-hash';

    const reformed = h.landUseEvent('startup:settled_intelligence');
    expect(reformed.path.outcome).toBe('produced');
    const read = h.currentPath()!;
    expect(read.contractVersion).toBe('1.0.1');
    expect(read.refresh.kind).toBe('contract');
    expect(read.refresh.changes).toHaveLength(0);
    expect(read.refresh.priorSnapshotId).toBe(current.id);
    expect(read.authority.nonQualifyingClaims[0].source).toBe('Planning and Zoning – City of Lake Butler');
    expect(h.store.versionsOf(ZONING_DEVELOPMENT_SNAPSHOT)).toBe(2);
    expect(h.store.rows.find((row) => row.id === current.id)!.status).toBe('superseded');
    expect((h.store.rows.find((row) => row.id === current.id)!.payload as RetainedDevelopmentPath).contractVersion).toBe('1.0.0');

    const again = h.landUseEvent('startup:settled_intelligence');
    expect(again.path.outcome).toBe('unchanged');
    expect(again.decision.outcome).toBe('unchanged');
    expect(h.store.versionsOf(ZONING_DEVELOPMENT_SNAPSHOT)).toBe(2);
  });

  it('re-forms a current decision written under an older decision contract the same way', () => {
    const h = harness();
    h.completion();
    const current = h.store.currentOf(DEAL_DECISION_SNAPSHOT)!;
    const stale = JSON.parse(JSON.stringify(current.payload)) as RetainedDealDecision;
    (stale as { contractVersion: string }).contractVersion = '1.5.0';
    current.payload = stale;
    current.inputHash = 'stale-decision-hash';
    const reformed = h.landUseEvent('startup:settled_intelligence');
    expect(reformed.path.outcome).toBe('unchanged');
    expect(reformed.decision.outcome).toBe('produced');
    const decision = h.currentDecision()!;
    expect(decision.contractVersion).toBe('1.5.2');
    expect(decision.refresh.kind).toBe('contract');
    expect(h.store.versionsOf(DEAL_DECISION_SNAPSHOT)).toBe(2);
    expect(h.store.rows.find((row) => row.id === current.id)!.status).toBe('superseded');
    expect(h.landUseEvent('startup:settled_intelligence').decision.outcome).toBe('unchanged');
  });
});

// ── 6. One truthful status ─────────────────────────────────────────────────

describe('developmentPathStatus', () => {
  it('maps absent, historical, partial and current reads on the shared vocabulary', () => {
    expect(developmentPathStatus(null, { dealCardId: 115 }).status).toBe('pending');
    const h = harness();
    h.completion();
    const reading = h.store.reading<RetainedDevelopmentPath>(ZONING_DEVELOPMENT_SNAPSHOT)!;
    expect(developmentPathStatus(reading, { dealCardId: 115, consumedSnapshotId: reading.snapshotId }).status).toBe('partial_current');
    expect(developmentPathStatus(reading, { dealCardId: 115, consumedSnapshotId: reading.snapshotId }).consumedByDealBrain).toBe(true);
    expect(developmentPathStatus({ ...reading, correlation: 'different' }, { dealCardId: 115 }).status).toBe('historical');
    expect(developmentPathStatus(reading, { dealCardId: 115 }).link).toBe('/dept/acquisitions/v2?deal=115&page=overview');
  });
});
