// LandOS — the Acquisition Intelligence DOSSIER.
//
// Acquisition Intelligence is a layer ABOVE research, not another research
// lane. Everything it reasons over was already collected, verified and retained
// by the existing capabilities. This module is the seam between the two: it
// takes the canonical property file exactly as LandOS already projects it and
// reduces it to one bounded, structured dossier an analyst can hold in mind at
// once.
//
// Three properties of this module matter and are enforced by its shape:
//
//   1. It is a PURE FUNCTION over data handed to it. It opens no network
//      connection, starts no research, touches no browser and reads no store.
//      That is what makes "Acquisition Intelligence never launches open-ended
//      research" a structural fact rather than a policy sentence.
//   2. It is BOUNDED. Every list is capped and every long passage truncated,
//      because a dossier that does not fit in a reasoning context is not a
//      dossier. What is dropped is counted, never silently lost.
//   3. It is DEFENSIVE. The projection is large, evolving and frequently
//      partial; a missing section produces an explicit absence in `coverage`,
//      not a crash and not a fabricated value.
//
// Nothing here decides anything about the property. It states what LandOS
// knows, what it does not, and where its own sources disagree.

import {
  reconcileMaterialFacts,
  type MaterialFactConflict,
} from './acquisition-intelligence-reconciliation.js';

// ── Tolerant readers over the canonical projection ────────────────────────
//
// The property file is assembled from a dozen independent capabilities and its
// exact shape differs by how much research a card has had. These readers make
// "absent" and "wrong type" the same, uneventful thing.

type Unknown = unknown;

const isRecord = (value: Unknown): value is Record<string, Unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export function at(source: Unknown, path: string): Unknown {
  let cursor: Unknown = source;
  for (const segment of path.split('.')) {
    if (!isRecord(cursor)) return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

const asArray = (value: Unknown): Unknown[] => (Array.isArray(value) ? value : []);

export function text(value: Unknown, max = 400): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

export function num(value: Unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const match = /-?[\d,]+(?:\.\d+)?/.exec(value);
  if (!match) return null;
  const parsed = Number(match[0].replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

const bool = (value: Unknown): boolean | null => (typeof value === 'boolean' ? value : null);

/** A LandOS "evidenced value" — `{ value, unresolved, qualityLabel, sources }` —
 *  flattened to the two things an analyst needs: what it says and how well it
 *  is known. */
function evidenced(value: Unknown, max = 300): { value: string | null; status: string | null } | null {
  if (!isRecord(value)) {
    const plain = text(value, max);
    return plain ? { value: plain, status: null } : null;
  }
  const stated = text(value.value, max);
  const unresolved = text(value.unresolved, max);
  const quality = text(value.qualityLabel ?? value.quality, 60);
  if (!stated && !unresolved) return null;
  return { value: stated, status: stated ? quality : (unresolved ?? 'Unresolved') };
}

// ── The dossier ───────────────────────────────────────────────────────────

export interface DossierVisual {
  /** Stable capture key, e.g. `close_parcel_aerial`. The analyst may cite only
   *  keys that appear here. */
  key: string;
  label: string;
  /** What this capture was taken to show. */
  purpose: string | null;
  capturedAt: string | null;
  /** Absolute path to the retained image, when one is resolvable on this
   *  machine. Without a path the visual is listed but cannot be inspected. */
  filePath: string | null;
}

/**
 * A GROUNDED visual observation: something a vision model reported after
 * actually receiving the underlying image pixels. This is the only kind of
 * visual claim the dossier carries as an observation — a caller that merely
 * held a filename, path, label, or alt text has not seen the image, and its
 * text is refused below rather than dressed up as vision.
 *
 * An observation is EVIDENCE, never a canonical fact: "no dwelling visibly
 * apparent" does not become "no house exists". The analyst reconciles it with
 * the record claims and carries the conflict, both values intact.
 */
export interface DossierVisualObservation {
  /** Stable citation key for this observation, distinct from capture keys. */
  key: string;
  category: string;
  observation: string;
  signal: 'positive' | 'concern' | 'neutral' | null;
  confidence: string | null;
  /** Label of the analyzed capture the observation came from. */
  sourceImage: string | null;
  /** The vision model that received the pixels. */
  model: string | null;
  /** When the vision analysis ran. */
  analyzedAt: string | null;
  /** When the underlying capture was taken — null means capture date unknown,
   *  and the imagery must be described as "retained", never "current". */
  capturedAt: string | null;
  /** Always true in the dossier: the assembler drops anything else. */
  pixelGrounded: true;
}

export interface AcquisitionDossier {
  dossierVersion: '1.0.0';
  dealCardId: number;
  propertyCardId: number | null;
  assembledAt: string;
  identity: {
    state: string | null;
    confirmed: boolean;
    displayAddress: string | null;
    apn: string | null;
    county: string | null;
    stateCode: string | null;
    owner: string | null;
    acres: number | null;
    acreageBasis: string | null;
    hasParcelGeometry: boolean | null;
    basis: string | null;
  };
  physical: {
    acres: number | null;
    buildablePct: string | null;
    buildableAcres: string | null;
    slopeAveragePct: string | null;
    acresUnder10PctSlope: string | null;
    elevation: string | null;
    femaFloodZone: string | null;
    femaCoveragePct: string | null;
    wetlandsPct: string | null;
    waterPresent: string | null;
    soils: string | null;
    improvement: string | null;
    parcelShapeNote: string | null;
  };
  access: {
    frontageFt: number | null;
    landLocked: string | null;
    roadName: string | null;
    legalAccessStatement: string | null;
    evidenceReached: string[];
    outstanding: string[];
  };
  landUse: {
    zoningEstablished: boolean | null;
    zoningStatement: string | null;
    districtCode: string | null;
    confidence: string | null;
    authority: string | null;
    historicalZoningReferences: Array<{ kind: string | null; value: string | null; asOf: string | null; sourceUrl: string | null }>;
    byRightUses: string[];
    manufacturedHousing: string[];
    limitations: string[];
  };
  subdivision: {
    authority: string | null;
    likelyPath: string | null;
    likelyPathWhy: string | null;
    lotCountStatement: string | null;
    minimumLotArea: string | null;
    minimumLotWidth: string | null;
    minimumRoadFrontage: string | null;
    flagLots: string | null;
    sharedDriveways: string | null;
    privateRoads: string | null;
    newRoadTrigger: string | null;
    rules: Array<{ label: string; value: string; section: string | null; sourceUrl: string | null; confidence: string | null }>;
  };
  history: {
    narrative: string | null;
    highlights: string[];
    openQuestions: string[];
    documents: Array<{ label: string; sourceUrl: string | null }>;
  };
  valuation: {
    status: string | null;
    basis: string | null;
    workingAcres: number | null;
    acceptedCompCount: number | null;
    medianPricePerAcre: number | null;
    fairMarketValue: number | null;
    lpEstimate: string | null;
    blockers: string[];
  };
  comps: {
    soldCount: number | null;
    activeCompetitionCount: number | null;
    askingReferenceCount: number | null;
    note: string | null;
  };
  market: {
    headline: string | null;
    acreageBand: string | null;
    medianDaysOnMarket: number | null;
    sellThroughRate: number | null;
    monthsOfSupply: number | null;
    medianPricePerAcre: number | null;
    fastestBand: string | null;
    interpretation: string | null;
  };
  utilities: {
    septicAuthority: string | null;
    perLotApproval: string | null;
    unresolved: string[];
  };
  /** The latest Assessor & Tax capability answer for this subject, bounded.
   *  This is what lets a targeted re-read reconcile a record-vs-imagery
   *  conflict against the CURRENT official record instead of re-arguing the
   *  provider claim. An honest "not retrieved" attempt is carried too — a
   *  failed official lookup is evidence about availability, never about the
   *  parcel. */
  officialAssessorRecord: {
    recordStatus: string | null;
    retrievedAt: string | null;
    jurisdiction: string | null;
    source: string | null;
    ownerOfRecord: string | null;
    assessedAcres: number | null;
    totalAppraisedValue: number | null;
    improvements: {
      structureType: string | null;
      yearBuilt: number | null;
      buildingSqft: number | null;
    } | null;
    summary: string | null;
    attemptNote: string | null;
  } | null;
  /** The bounded SELLER EVIDENCE record: everything LandOS has actually
   *  persisted about the seller relationship for this deal. Every statement
   *  sourced from the seller stays SELLER-REPORTED — evidence attributed to
   *  the seller, never a canonical property fact. */
  seller: {
    present: boolean;
    name: string | null;
    askingPrice: number | null;
    stage: string | null;
    people: Array<{ name: string; role: string | null; authorityStatus: string | null; primaryContact: boolean | null }>;
    profile: {
      motivation: string | null;
      timeline: string | null;
      askingPriceStated: string | null;
      priceFlexibility: string | null;
      decisionMakers: string | null;
      relationshipToProperty: string | null;
      lastContactDate: string | null;
      nextFollowUpDate: string | null;
      objections: string[];
      concerns: string[];
      commitments: string[];
      unknowns: string[];
    } | null;
    /** SELLER-REPORTED statements with provenance: what was said, where it was
     *  recorded, and when. */
    sellerReportedFacts: Array<{ statement: string; source: string; at: string | null }>;
    /** Chronological (oldest → newest) communication record, bounded with the
     *  earliest entries retained so evolution over time stays detectable. */
    communications: Array<{
      at: string | null;
      type: string;
      direction: string | null;
      summary: string;
      outcome: string | null;
      sentiment: string | null;
      followUpDate: string | null;
    }>;
    /** Structured discovery-call extractions, oldest → newest. */
    discovery: Array<{
      capturedAt: string | null;
      motivation: string | null;
      timeline: string | null;
      priceExpectation: string | null;
      decisionMakers: string | null;
      urgency: string | null;
      emotionalTone: string | null;
      objections: string[];
      followUpItems: string[];
      unansweredQuestions: string[];
    }>;
    /** Honest totals before bounding — the record is larger than the dossier. */
    evidenceCounts: { communications: number; discoveryExtractions: number; reportedFacts: number };
  };
  documents: Array<{ label: string; sourceUrl: string | null }>;
  visuals: DossierVisual[];
  /** Pixel-grounded visual observations from the retained imagery. Evidence,
   *  never canonical facts; ungrounded input never lands here. */
  visualObservations: DossierVisualObservation[];
  /** Material disagreements across retained sources. Surfaced, never resolved
   *  here: the analyst is told to carry them, not to pick a winner. */
  conflicts: MaterialFactConflict[];
  openQuestions: string[];
  blockers: string[];
  missingInformation: string[];
  /** What the dossier actually carries and what it does not. This is what
   *  keeps a thin file from reading as a complete one. */
  coverage: { present: string[]; absent: string[] };
  /** Anything the bounding dropped, counted rather than hidden. */
  truncation: string[];
}

/** Everything the assembler is allowed to see. The caller resolves these from
 *  the existing canonical reads; the assembler reaches for nothing else. */
export interface PropertyFileSource {
  dealCardId: number;
  propertyCardId?: number | null;
  /** The `/property-intelligence` projection, verbatim. */
  propertyIntelligence?: Unknown;
  marketContext?: Unknown;
  documentRegistry?: Unknown;
  /** Deal-level operator record: title, asking price, people. */
  dealCard?: Unknown;
  /** The Acquisitions CRM state for this deal — seller profile, manual
   *  communication log and discovery extractions — verbatim. */
  acquisition?: Unknown;
  /** Seller-stated fact rows recorded on the deal's subject Property Card. */
  sellerStatedFacts?: Unknown;
  /** The latest persisted Assessor & Tax capability RESULT for this subject,
   *  verbatim from the invocation ledger. */
  assessorTax?: Unknown;
  /** Retained visual assets, resolved to files on this machine. */
  visuals?: Array<{ key: string; label?: string | null; purpose?: string | null; capturedAt?: string | null; filePath?: string | null }>;
  /** Candidate visual observations. Only entries the caller can vouch for as
   *  pixel-grounded (`pixelGrounded: true`) are carried; the rest are dropped
   *  and counted. */
  visualObservations?: Array<{
    category?: string | null;
    observation?: string | null;
    signal?: string | null;
    confidence?: string | null;
    sourceImage?: string | null;
    model?: string | null;
    analyzedAt?: string | null;
    capturedAt?: string | null;
    pixelGrounded?: boolean;
  }>;
  now?: () => Date;
}

const MAX_RULES = 18;
const MAX_LIST = 10;
const MAX_VISUALS = 12;

function capped<T>(items: T[], limit: number, what: string, truncation: string[]): T[] {
  if (items.length <= limit) return items;
  truncation.push(`${what}: ${items.length - limit} of ${items.length} not carried into the dossier.`);
  return items.slice(0, limit);
}

function strings(value: Unknown, limit: number, what: string, truncation: string[], max = 300): string[] {
  const out = asArray(value)
    .map((item) => (isRecord(item) ? text(item.label ?? item.statement ?? item.question ?? item.value, max) : text(item, max)))
    .filter((item): item is string => !!item);
  return capped([...new Set(out)], limit, what, truncation);
}

export function buildAcquisitionDossier(source: PropertyFileSource): AcquisitionDossier {
  const truncation: string[] = [];
  const pi = source.propertyIntelligence;
  const snapshot = at(pi, 'snapshot');
  const lpf = at(pi, 'landPortalFacts');
  const access = at(pi, 'access');
  const landUse = at(pi, 'landUse');
  const lui = at(pi, 'landUseIntelligence');
  const cv = at(pi, 'compsValuation');
  const marketSource = source.marketContext ?? at(pi, 'compsValuation.marketContext');

  const identityAcres = num(at(snapshot, 'identity.acres')) ?? num(at(lpf, 'acres'));
  const identity: AcquisitionDossier['identity'] = {
    state: text(at(snapshot, 'identity.state'), 40),
    confirmed: text(at(snapshot, 'identity.state'), 40) === 'confirmed',
    displayAddress: text(at(snapshot, 'identity.displayAddress'), 200)
      ?? text(at(snapshot, 'identity.normalizedAddress'), 200)
      ?? text(at(lpf, 'parcelAddress'), 200),
    apn: text(at(snapshot, 'identity.apn'), 60) ?? text(at(lpf, 'apn'), 60),
    county: text(at(snapshot, 'identity.county'), 80) ?? text(at(lpf, 'county'), 80),
    stateCode: text(at(snapshot, 'identity.state_'), 8) ?? text(at(lpf, 'stateCode'), 8),
    owner: text(at(snapshot, 'identity.owner'), 120) ?? text(at(lpf, 'owner'), 120),
    acres: identityAcres,
    acreageBasis: text(at(snapshot, 'identity.acreageBasis'), 60),
    hasParcelGeometry: bool(at(snapshot, 'identity.hasParcelGeometry')),
    basis: text(at(snapshot, 'identity.discoveryBasis'), 500) ?? text(at(snapshot, 'identity.explanation'), 500),
  };

  const physical: AcquisitionDossier['physical'] = {
    acres: identityAcres,
    buildablePct: text(at(lpf, 'buildability.pct'), 40),
    buildableAcres: text(at(lpf, 'buildability.acres'), 40),
    slopeAveragePct: text(at(lpf, 'terrain.slopeAvgPct'), 40),
    acresUnder10PctSlope: text(at(lpf, 'terrain.slopeUnder10Pct'), 60),
    elevation: text(at(lpf, 'terrain.label'), 200),
    femaFloodZone: text(at(lpf, 'environment.femaFloodZone'), 80),
    femaCoveragePct: text(at(lpf, 'environment.femaCoveragePct'), 40),
    wetlandsPct: text(at(lpf, 'environment.wetlandsPct'), 40),
    waterPresent: text(at(lpf, 'water.label'), 120),
    soils: text(at(lpf, 'soils.label'), 200),
    improvement: text(at(lpf, 'improvement.label'), 200),
    parcelShapeNote: text(at(lpf, 'parcelContext.label'), 200),
  };

  // Frontage is read from BOTH retained sources on purpose. Where they
  // disagree, reconciliation below carries both values rather than picking.
  const accessSection: AcquisitionDossier['access'] = {
    frontageFt: num(at(access, 'frontageFt')) ?? num(at(lpf, 'access.roadFrontageFt')),
    landLocked: text(at(lpf, 'access.landLocked'), 40),
    roadName: text(at(access, 'road'), 120),
    legalAccessStatement: text(at(access, 'legalAccess'), 300),
    evidenceReached: asArray(at(access, 'evidence.rungs'))
      .filter((rung) => isRecord(rung) && text(rung.status, 40) !== 'not_evidenced')
      .map((rung) => text(at(rung, 'label'), 80))
      .filter((label): label is string => !!label),
    outstanding: strings(at(access, 'evidence.outstanding'), MAX_LIST, 'Access outstanding items', truncation),
  };

  const zoningReferences = capped(
    asArray(at(lui, 'currentZoning.references')).map((ref) => ({
      kind: text(at(ref, 'kindLabel'), 60),
      value: text(at(ref, 'value'), 60),
      asOf: text(at(ref, 'asOf'), 60),
      sourceUrl: text(at(ref, 'sourceUrl'), 400),
    })),
    MAX_LIST,
    'Historical zoning references',
    truncation,
  );

  const landUseSection: AcquisitionDossier['landUse'] = {
    zoningEstablished: bool(at(lui, 'currentZoning.established')),
    zoningStatement: text(at(lui, 'currentZoning.statement'), 500)
      ?? text(at(landUse, 'zoning.presenceLabel'), 200),
    districtCode: text(at(lui, 'currentZoning.districtCode'), 60),
    confidence: text(at(lui, 'currentZoning.confidence'), 40),
    authority: text(at(lui, 'currentZoning.authorityName'), 120)
      ?? text(at(lui, 'authority.municipality'), 120),
    historicalZoningReferences: zoningReferences,
    byRightUses: strings(at(landUse, 'byRightUses'), MAX_LIST, 'By-right uses', truncation),
    manufacturedHousing: strings(at(landUse, 'manufacturedHousing'), MAX_LIST, 'Manufactured-housing findings', truncation),
    limitations: strings(at(lui, 'currentZoning.limitations'), MAX_LIST, 'Zoning limitations', truncation),
  };

  // The subdivision read comes from two places that answer differently: the
  // jurisdiction rule package (`landUseIntelligence.subdivision`) and the
  // deterministic property read (`landUse.subdivision`). Both are carried.
  const subdivisionValue = (key: string): string | null => {
    const fromProperty = evidenced(at(landUse, `subdivision.${key}`));
    const fromFallback = evidenced(at(landUse, `countySubdivisionFallback.${key}`));
    const chosen = fromProperty?.value ? fromProperty : (fromFallback?.value ? fromFallback : fromProperty ?? fromFallback);
    if (!chosen) return null;
    return chosen.value ? `${chosen.value}${chosen.status ? ` (${chosen.status})` : ''}` : chosen.status;
  };

  const subdivision: AcquisitionDossier['subdivision'] = {
    authority: text(at(lui, 'subdivision.authorityName'), 120),
    likelyPath: text(at(lui, 'subdivision.likelyPathLabel'), 120),
    likelyPathWhy: text(at(lui, 'subdivision.likelyPathWhy'), 500),
    lotCountStatement: text(at(lui, 'subdivision.lotCountStatement'), 700),
    minimumLotArea: subdivisionValue('minimumLotArea'),
    minimumLotWidth: subdivisionValue('minimumLotWidth'),
    minimumRoadFrontage: subdivisionValue('minimumRoadFrontage'),
    flagLots: subdivisionValue('flagLots'),
    sharedDriveways: subdivisionValue('sharedDriveways'),
    privateRoads: subdivisionValue('privateRoads'),
    newRoadTrigger: subdivisionValue('newRoadTrigger'),
    rules: capped(
      asArray(at(lui, 'subdivision.rules'))
        .map((rule) => ({
          label: text(at(rule, 'label'), 120) ?? '',
          value: text(at(rule, 'value'), 320) ?? '',
          section: text(at(rule, 'section'), 60),
          sourceUrl: text(at(rule, 'sourceUrl'), 400),
          confidence: text(at(rule, 'confidence'), 40),
        }))
        .filter((rule) => rule.label && rule.value),
      MAX_RULES,
      'Subdivision rules',
      truncation,
    ),
  };

  const history: AcquisitionDossier['history'] = {
    narrative: text(at(lui, 'backstory.narrative'), 1_800),
    highlights: strings(at(lui, 'backstory.highlights'), MAX_LIST, 'Property history highlights', truncation),
    openQuestions: strings(at(lui, 'backstory.openQuestions'), MAX_LIST, 'Property history open questions', truncation),
    documents: capped(
      asArray(at(lui, 'backstory.documents')).map((doc) => ({
        label: text(at(doc, 'label') ?? at(doc, 'title'), 160) ?? 'Retained document',
        sourceUrl: text(at(doc, 'sourceUrl') ?? at(doc, 'url'), 400),
      })),
      MAX_LIST,
      'Property history documents',
      truncation,
    ),
  };

  const valuation: AcquisitionDossier['valuation'] = {
    status: text(at(cv, 'summary.statusLabel'), 160) ?? text(at(cv, 'summary.status'), 80),
    basis: text(at(cv, 'summary.basisLabel'), 200),
    workingAcres: num(at(cv, 'summary.workingAcres')),
    acceptedCompCount: num(at(cv, 'summary.acceptedCount')),
    medianPricePerAcre: num(at(cv, 'summary.medianPricePerAcre')),
    fairMarketValue: num(at(cv, 'summary.fmv')),
    lpEstimate: text(at(cv, 'lpEstimate.priceLabel'), 80),
    blockers: strings(at(pi, 'canonicalState.valuation.blockers'), MAX_LIST, 'Valuation blockers', truncation),
  };

  const comps: AcquisitionDossier['comps'] = {
    soldCount: num(at(cv, 'counts.accepted_closed_sale')),
    activeCompetitionCount: num(at(cv, 'counts.active_competition')),
    askingReferenceCount: num(at(cv, 'counts.asking_reference')),
    note: text(at(cv, 'summary.statusReason'), 500)
      ?? text(at(pi, 'canonicalState.comps.conclusion'), 500),
  };

  const market: AcquisitionDossier['market'] = {
    headline: text(at(marketSource, 'read.headline'), 300),
    acreageBand: text(at(marketSource, 'read.acreageBandLabel'), 80),
    medianDaysOnMarket: num(at(marketSource, 'liquidity.medianDaysOnMarket')),
    sellThroughRate: num(at(marketSource, 'liquidity.sellThroughRate')),
    monthsOfSupply: num(at(marketSource, 'liquidity.monthsOfSupply')),
    medianPricePerAcre: num(at(marketSource, 'liquidity.medianPricePerAcre')),
    fastestBand: text(at(marketSource, 'fastestBand.acreageBandLabel'), 80),
    interpretation: text(at(marketSource, 'interpretation'), 800),
  };

  const utilities: AcquisitionDossier['utilities'] = {
    septicAuthority: evidenced(at(landUse, 'septicWell.authority'), 160)?.value ?? null,
    perLotApproval: subdivisionValueOf(at(landUse, 'septicWell.perLotApprovalRequired')),
    unresolved: strings(at(landUse, 'septicWell.unresolved'), MAX_LIST, 'Septic/well unresolved items', truncation),
  };

  const seller = buildSellerEvidence(source, truncation);

  // The latest Assessor & Tax capability result, projected into a bounded
  // official-record section. Only a result whose facts are actually present is
  // carried; a null ledger read leaves the section null and the coverage list
  // says so honestly.
  const officialAssessorRecord: AcquisitionDossier['officialAssessorRecord'] = (() => {
    const at_ = source.assessorTax;
    const facts = at(at_, 'facts');
    if (!facts) return null;
    const improvements = at(facts, 'improvements');
    const structureType = text(at(improvements, 'structureType'), 160);
    const yearBuilt = num(at(improvements, 'yearBuilt'));
    const buildingSqft = num(at(improvements, 'buildingSqft'));
    return {
      recordStatus: text(at(facts, 'recordStatus'), 60),
      retrievedAt: text(at(at_, 'timestamps.completedAt'), 40),
      jurisdiction: text(at(facts, 'jurisdiction'), 120),
      source: text(at(asArray(at(at_, 'evidence'))[0], 'source'), 200)
        ?? text(at(asArray(at(facts, 'sourceAttempts'))[0], 'source'), 200),
      ownerOfRecord: text(at(facts, 'assessor.ownerOfRecord'), 160),
      assessedAcres: num(at(facts, 'assessor.assessedAcres')),
      totalAppraisedValue: num(at(facts, 'assessor.totalAppraisedValue')),
      improvements: structureType || yearBuilt != null || buildingSqft != null
        ? { structureType, yearBuilt, buildingSqft }
        : null,
      summary: text(at(facts, 'summary'), 600),
      attemptNote: text(asArray(at(at_, 'warnings'))[0], 600),
    };
  })();

  const documents = capped(
    asArray(at(source.documentRegistry, 'documents')).map((doc) => ({
      label: text(at(doc, 'title') ?? at(doc, 'label'), 200) ?? 'Retained document',
      sourceUrl: text(at(doc, 'sourceUrl') ?? at(doc, 'url'), 400),
    })),
    MAX_LIST,
    'Deal documents',
    truncation,
  );

  const visuals = capped(
    (source.visuals ?? []).map((visual) => ({
      key: visual.key,
      label: text(visual.label, 120) ?? visual.key.replace(/_/g, ' '),
      purpose: text(visual.purpose, 200),
      capturedAt: text(visual.capturedAt, 40),
      filePath: visual.filePath ?? null,
    })),
    MAX_VISUALS,
    'Retained visuals',
    truncation,
  );

  // GROUNDING GATE. Only observations the caller marked pixel-grounded are
  // carried; anything else (a path-only pass, a label, alt text) is dropped
  // and the drop is counted rather than hidden. Keys are generated here so an
  // observation is citable independently of the capture list.
  const candidateObservations = source.visualObservations ?? [];
  const groundedCandidates = candidateObservations.filter(
    (candidate) => candidate.pixelGrounded === true && !!text(candidate.observation, 800),
  );
  const droppedUngrounded = candidateObservations.length - groundedCandidates.length;
  if (droppedUngrounded > 0) {
    truncation.push(`Visual observations: ${droppedUngrounded} entr${droppedUngrounded === 1 ? 'y' : 'ies'} without proven pixel grounding were excluded from the dossier.`);
  }
  const usedObservationKeys = new Set<string>();
  const visualObservations = capped(
    groundedCandidates.map((candidate, index): DossierVisualObservation => {
      const category = text(candidate.category, 60) ?? 'other';
      const base = `vision_${category.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`;
      let key = base;
      for (let n = 2; usedObservationKeys.has(key); n += 1) key = `${base}_${n}`;
      usedObservationKeys.add(key);
      const signalRaw = text(candidate.signal, 20);
      return {
        key,
        category,
        observation: text(candidate.observation, 800) ?? `observation ${index + 1}`,
        signal: (signalRaw === 'positive' || signalRaw === 'concern' || signalRaw === 'neutral' ? signalRaw : null),
        confidence: text(candidate.confidence, 40),
        sourceImage: text(candidate.sourceImage, 120),
        model: text(candidate.model, 80),
        analyzedAt: text(candidate.analyzedAt, 40),
        capturedAt: text(candidate.capturedAt, 40),
        pixelGrounded: true as const,
      };
    }),
    MAX_VISUALS,
    'Grounded visual observations',
    truncation,
  );

  const conflicts = reconcileMaterialFacts(source);

  const openQuestions = strings(
    at(pi, 'researchStatus.openQuestions'),
    MAX_LIST,
    'Open research questions',
    truncation,
    400,
  );
  const blockers = strings(at(pi, 'canonicalState.blockers'), MAX_LIST, 'Blockers', truncation, 400);
  const missingInformation = strings(
    at(pi, 'canonicalState.missingInformation'),
    MAX_LIST,
    'Missing information',
    truncation,
    300,
  );

  const present: string[] = [];
  const absent: string[] = [];
  const record = (label: string, has: boolean) => (has ? present : absent).push(label);
  record('Property identity', identity.confirmed);
  record('LandPortal parcel facts', !!lpf);
  record('Physical characteristics', !!physical.buildablePct || !!physical.slopeAveragePct);
  record('Access evidence', accessSection.evidenceReached.length > 0);
  record('Current zoning', landUseSection.zoningEstablished === true);
  record('Subdivision rules', subdivision.rules.length > 0);
  record('Property development history', !!history.narrative);
  record('Comps', (comps.soldCount ?? 0) > 0);
  record('Valuation', valuation.fairMarketValue != null);
  record('Market intelligence', !!market.headline);
  record('Retained visuals', visuals.length > 0);
  record('Grounded visual observations', visualObservations.length > 0);
  record('Seller information', seller.present);
  record('Seller communication record', seller.communications.length > 0 || seller.discovery.length > 0);
  record('Seller-reported property facts', seller.sellerReportedFacts.length > 0);
  record('Official assessor record', officialAssessorRecord?.recordStatus === 'official_record_retrieved');

  return {
    dossierVersion: '1.0.0',
    dealCardId: source.dealCardId,
    propertyCardId: source.propertyCardId ?? num(at(snapshot, 'identity.propertyCardId')) ?? null,
    assembledAt: (source.now?.() ?? new Date()).toISOString(),
    identity,
    physical,
    access: accessSection,
    landUse: landUseSection,
    subdivision,
    history,
    valuation,
    comps,
    market,
    utilities,
    officialAssessorRecord,
    seller,
    documents,
    visuals,
    visualObservations,
    conflicts,
    openQuestions,
    blockers,
    missingInformation,
    coverage: { present, absent },
    truncation,
  };
}

// ── Seller evidence assembly ──────────────────────────────────────────────
//
// The seller section is assembled from the sources LandOS already persists —
// the deal's people, the Acquisitions CRM state (profile, communication log,
// discovery extractions) and the seller-stated fact record — never from a new
// store. Everything the seller said stays SELLER-REPORTED with its provenance;
// chronology is preserved oldest → newest, and when the communication record
// outgrows the bound the EARLIEST entries are retained alongside the most
// recent so a material older statement is never truncated away merely for
// being old.

const MAX_SELLER_COMMS = 24;
const MAX_SELLER_COMMS_HEAD = 4;
const MAX_SELLER_FACTS = 16;
const MAX_SELLER_DISCOVERY = 6;

/** Keep chronological order under a cap: the earliest `head` entries plus the
 *  most recent remainder, so both ends of the record survive bounding. */
function boundedChronology<T>(items: T[], limit: number, head: number, what: string, truncation: string[]): T[] {
  if (items.length <= limit) return items;
  truncation.push(`${what}: ${items.length - limit} of ${items.length} not carried into the dossier (earliest ${head} and most recent ${limit - head} retained).`);
  return [...items.slice(0, head), ...items.slice(items.length - (limit - head))];
}

function buildSellerEvidence(source: PropertyFileSource, truncation: string[]): AcquisitionDossier['seller'] {
  const acquisition = source.acquisition;
  const profileSource = at(acquisition, 'profile');

  const people = capped(
    asArray(at(source.dealCard, 'people'))
      .map((person) => ({
        name: text(at(person, 'name'), 160) ?? '',
        role: text(at(person, 'role'), 60),
        authorityStatus: text(at(person, 'authorityStatus') ?? at(person, 'authority_status'), 80),
        primaryContact: bool(at(person, 'primaryContact') ?? at(person, 'primary_contact')),
      }))
      .filter((person) => person.name),
    MAX_LIST,
    'Deal people',
    truncation,
  );

  const profile: AcquisitionDossier['seller']['profile'] = isRecord(profileSource) && Object.keys(profileSource).length
    ? {
      motivation: text(at(profileSource, 'motivation'), 600),
      timeline: text(at(profileSource, 'timeline'), 400),
      askingPriceStated: text(at(profileSource, 'askingPrice'), 120),
      priceFlexibility: text(at(profileSource, 'priceFlexibility'), 400),
      decisionMakers: text(at(profileSource, 'decisionMakers'), 400),
      relationshipToProperty: text(at(profileSource, 'relationshipToProperty'), 300),
      lastContactDate: text(at(profileSource, 'lastContactDate'), 40),
      nextFollowUpDate: text(at(profileSource, 'nextFollowUpDate'), 40),
      objections: strings(at(profileSource, 'objections'), MAX_LIST, 'Seller profile objections', truncation),
      concerns: strings(at(profileSource, 'concerns'), MAX_LIST, 'Seller profile concerns', truncation),
      commitments: strings(at(profileSource, 'commitments'), MAX_LIST, 'Seller profile commitments', truncation),
      unknowns: strings(at(profileSource, 'unknowns'), MAX_LIST, 'Seller profile unknowns', truncation),
    }
    : null;

  // Chronology: the CRM stores the log newest-first; the dossier carries it
  // oldest → newest so evolution over time reads forward.
  const commEntries = asArray(at(acquisition, 'commLog'))
    .map((entry) => ({
      at: text(at(entry, 'at') ?? at(entry, 'createdAt'), 40),
      type: text(at(entry, 'type'), 20) ?? text(at(entry, 'channel'), 20) ?? 'note',
      direction: text(at(entry, 'direction'), 20),
      summary: text(at(entry, 'summary'), 500) ?? '',
      outcome: text(at(entry, 'outcome'), 300),
      sentiment: text(at(entry, 'sentiment'), 20),
      followUpDate: text(at(entry, 'followUpDate'), 40),
      keyFacts: strings(at(entry, 'keyFacts'), MAX_LIST, 'Communication key facts', truncation),
    }))
    .filter((entry) => entry.summary)
    .sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''));
  const communications = boundedChronology(
    commEntries.map(({ keyFacts: _keyFacts, ...entry }) => entry),
    MAX_SELLER_COMMS,
    MAX_SELLER_COMMS_HEAD,
    'Seller communications',
    truncation,
  );

  const discoveryEntries = asArray(at(acquisition, 'discovery'))
    .map((entry) => ({
      capturedAt: text(at(entry, 'capturedAt'), 40),
      motivation: text(at(entry, 'motivation'), 500),
      timeline: text(at(entry, 'timeline'), 300),
      priceExpectation: text(at(entry, 'priceExpectation'), 300),
      decisionMakers: text(at(entry, 'decisionMakers'), 300),
      urgency: text(at(entry, 'urgency'), 200),
      emotionalTone: text(at(entry, 'emotionalTone'), 200),
      objections: strings(at(entry, 'objections'), MAX_LIST, 'Discovery objections', truncation),
      followUpItems: strings(at(entry, 'followUpItems'), MAX_LIST, 'Discovery follow-up items', truncation),
      unansweredQuestions: strings(at(entry, 'unansweredQuestions'), MAX_LIST, 'Discovery unanswered questions', truncation),
      sellerClaimedFacts: strings(at(entry, 'sellerClaimedFacts'), MAX_LIST, 'Discovery seller-claimed facts', truncation),
    }))
    .sort((a, b) => (a.capturedAt ?? '').localeCompare(b.capturedAt ?? ''));
  const discovery = boundedChronology(
    discoveryEntries.map(({ sellerClaimedFacts: _sellerClaimedFacts, ...entry }) => entry),
    MAX_SELLER_DISCOVERY,
    1,
    'Discovery extractions',
    truncation,
  );

  // SELLER-REPORTED facts from every persisted source, each with provenance.
  // Deduplicated on the normalized statement; the first (earliest-sourced)
  // provenance wins.
  const factCandidates: Array<{ statement: string | null; source: string; at: string | null }> = [
    ...asArray(source.sellerStatedFacts).map((fact) => ({
      statement: [text(at(fact, 'kind'), 60), text(at(fact, 'value'), 500)].filter(Boolean).join(': ') || null,
      source: 'seller_stated_fact record',
      at: (() => {
        const recordedAt = num(at(fact, 'recordedAt'));
        return recordedAt ? new Date(recordedAt * 1000).toISOString().slice(0, 10) : null;
      })(),
    })),
    ...discoveryEntries.flatMap((entry) => entry.sellerClaimedFacts.map((statement) => ({
      statement,
      source: 'discovery call',
      at: entry.capturedAt,
    }))),
    ...commEntries.flatMap((entry) => entry.keyFacts.map((statement) => ({
      statement,
      source: `${entry.type} log`,
      at: entry.at,
    }))),
    ...asArray(at(profileSource, 'sellerStatedFacts')).map((statement) => ({
      statement: text(statement, 500),
      source: 'seller profile',
      at: null as string | null,
    })),
  ];
  const seenStatements = new Set<string>();
  const sellerReportedFacts = capped(
    factCandidates
      .filter((candidate): candidate is { statement: string; source: string; at: string | null } => !!candidate.statement)
      .filter((candidate) => {
        const key = candidate.statement.toLowerCase();
        if (seenStatements.has(key)) return false;
        seenStatements.add(key);
        return true;
      }),
    MAX_SELLER_FACTS,
    'Seller-reported facts',
    truncation,
  );

  return {
    present: people.length > 0 || !!profile || commEntries.length > 0,
    name: people[0]?.name ?? text(at(profileSource, 'name'), 160),
    askingPrice: num(at(source.dealCard, 'asking_price')),
    stage: text(at(acquisition, 'stage'), 40),
    people,
    profile,
    sellerReportedFacts,
    communications,
    discovery,
    evidenceCounts: {
      communications: commEntries.length,
      discoveryExtractions: discoveryEntries.length,
      reportedFacts: sellerReportedFacts.length,
    },
  };
}

/** Flatten one evidenced value to "statement (quality)" for the dossier. */
function subdivisionValueOf(value: Unknown): string | null {
  const flattened = evidenced(value);
  if (!flattened) return null;
  return flattened.value ? `${flattened.value}${flattened.status ? ` (${flattened.status})` : ''}` : flattened.status;
}
