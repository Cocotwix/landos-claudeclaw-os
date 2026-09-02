// LandOS — landos-zoning-subdivision-entitlement.
//
// Stages 1–4 retain what the jurisdiction says (controlling authority, the
// current district, the district's standards, the subdivision regulations, and
// the property-specific subdivision read) and what the parcel is (the Property
// Story). None of that is a development path. This capability applies the
// LOCAL jurisdiction's own rules to the accepted subject and returns ONE
// structured Development Path object:
//
//   • who governs (state, county, municipality or township, ETJ / planning
//     area, special authorities), with the official evidence and any conflict
//     between the retained authority record and the official boundary;
//   • the current district, with its source basis and effective date;
//   • the uses that matter to the company's strategies, each by-right,
//     conditional, prohibited or NOT ESTABLISHED — never "allowed" by silence;
//   • the dimensional standards that decide yield, each traced to its section;
//   • the jurisdiction's OWN minor and major paths, in its own words: label,
//     trigger, threshold, authority, materials, approval steps, open gates;
//   • the smallest decisive verification for every potentially viable path.
//
// Rules held by construction:
//
//   • No nationwide definition of "minor" or "major" is hard-coded. The local
//     regulation's own definition is the path's label and trigger; when the
//     regulation is not retained, the path is NOT ESTABLISHED and the decisive
//     action is to obtain it.
//   • Cost and time appear only when a retained source states them or the
//     operator supplied them. Otherwise they are named as missing inputs.
//   • Official boundary evidence outranks a jurisdiction-level web page when
//     the two disagree about who governs; the conflict is recorded, never
//     silently resolved.
//   • A theoretical lot count is arithmetic, never an approved yield.
//
// Pure: no model, no browser, no network, no clock in the persisted payload.

import { createHash } from 'node:crypto';

import type { AcquisitionDossier } from './acquisition-intelligence-dossier.js';
import type { CanonicalSubjectState } from './canonical-subject-state.js';
import type { AuthorityAssignment, AuthoritySourceTier, ControllingLandUseAuthority } from './controlling-land-use-authority.js';
import type { CurrentZoningDetermination } from './current-zoning-determination.js';
import type { StrategyId } from './offer-engine.js';
import type { PropertyEvidenceSynthesis } from './property-evidence-synthesis.js';
import type { ClaimWeight } from './source-aware-synthesis.js';
import type { PropertySubdivisionRead } from './subdivision-property-read.js';
import type { SubdivisionRegulations, SubdivisionRule, SubdivisionRuleKey } from './subdivision-regulations.js';
import type { ZoningStandardsResult } from './zoning-standards-research.js';
import type { ZoningAnalysis } from './zoning-types.js';

export const ZONING_DEVELOPMENT_INTELLIGENCE_VERSION = '1.0.1';
export const ZONING_DEVELOPMENT_SNAPSHOT = 'zoning_development_intelligence_v1';
export const ZONING_DEVELOPMENT_SKILL = 'landos-zoning-subdivision-entitlement';

// ── Vocabulary ──────────────────────────────────────────────────────────────

export interface DevelopmentSourceRef {
  label: string;
  url: string | null;
  tier: AuthoritySourceTier | 'official_boundary_geography' | 'operator_supplied';
  /** The date the SOURCE carries, when it carries one. */
  effectiveOrAsOf: string | null;
  retrievedAt: string | null;
  section: string | null;
  /** The source's own wording, when retained. */
  excerpt: string | null;
  /** What the source carried into this object. */
  carries: string;
}

export type AuthorityWorkingLevel = 'municipal' | 'county' | 'state' | 'joint_municipal_county' | 'special_or_overlay_district' | 'unknown';

export interface GoverningAuthorityRead {
  state: string | null;
  county: string | null;
  municipalityOrTownship: string | null;
  incorporationStatus: 'incorporated' | 'unincorporated' | 'unverified';
  /** The government LandOS is working against for zoning, and why. */
  zoning: { name: string | null; level: AuthorityWorkingLevel; weight: ClaimWeight; basis: string };
  subdivision: { name: string | null; level: AuthorityWorkingLevel; weight: ClaimWeight; basis: string };
  planningBody: string | null;
  /** Extraterritorial jurisdiction or a planning area, when a retained source
   *  addresses one; otherwise the honest absence. */
  etjOrPlanningArea: { status: 'established' | 'not_established'; statement: string };
  /** Overlay, historic, redevelopment or other special authorities a retained
   *  source referenced for this jurisdiction. Never a parcel-level finding. */
  specialAuthorities: string[];
  boundaryEvidence: {
    sourceLabel: string;
    incorporationStatus: string;
    controllingAuthorityName: string | null;
    controllingAuthorityLevel: string;
    determination: string;
    officialBoundaryEvidence: boolean;
    mailingCityDiffersFromAuthority: boolean;
    basis: string;
  } | null;
  /** Recorded only when two SUBJECT-SPECIFIC sources genuinely disagree about
   *  who governs. Never silently resolved; never raised by a postal locality. */
  conflict: {
    statement: string;
    sides: Array<{ claim: string; source: string; url: string | null; retrievedAt: string | null; applicability: string; weight: string }>;
    decisiveVerification: string;
  } | null;
  /** Retained authority claims that could not place THIS parcel: a
   *  jurisdiction-level page keyed to the mailing city, a county page for a
   *  parcel the boundary places inside a city. Kept visible, never adopted. */
  nonQualifyingClaims: Array<{ claim: string; level: AuthorityWorkingLevel; source: string; url: string | null; retrievedAt: string | null; reason: string }>;
  /** The subject address's postal locality, and why it decides nothing. */
  postalLocality: { city: string | null; statement: string };
  sources: DevelopmentSourceRef[];
}

export interface ZoningDistrictRead {
  established: boolean;
  districtCode: string | null;
  districtName: string | null;
  overlays: string[];
  evidenceKind: string | null;
  parcelMatchBasis: string | null;
  effectiveOrAsOf: string | null;
  weight: ClaimWeight;
  statement: string;
  source: DevelopmentSourceRef | null;
  /** Zoning the historical record stated. Never the current district. */
  historicalReferences: Array<{ kind: string | null; value: string | null; asOf: string | null }>;
  limitations: string[];
}

export type UseStanding = 'by_right' | 'conditional' | 'prohibited' | 'not_established';

export interface StrategyUseRead {
  key: string;
  label: string;
  standing: UseStanding;
  /** The ordinance's own wording, when a finding carried it. */
  finding: string | null;
  section: string | null;
  source: DevelopmentSourceRef | null;
  /** The company strategies this use gates. */
  strategies: StrategyId[];
  statement: string;
}

export type StandardKey =
  | 'lot_area' | 'density' | 'frontage' | 'lot_width' | 'setbacks' | 'height_or_coverage'
  | 'road_access' | 'utilities' | 'well_septic' | 'environmental' | 'other';

export interface DimensionalStandardRead {
  key: StandardKey;
  label: string;
  status: 'established' | 'not_established';
  value: string | null;
  section: string | null;
  source: DevelopmentSourceRef | null;
  /** What still has to be read when the standard is not established. */
  gap: string | null;
}

export interface SubjectScreen {
  acres: number | null;
  acreageBasis: string | null;
  frontageFt: number | null;
  roadName: string | null;
  accessEstablished: boolean;
  accessStatement: string;
  wetlandsPct: number | null;
  floodZone: string | null;
  buildableAcres: string | null;
  improvement: string | null;
  wellSepticStatus: string;
  utilitiesStatus: string;
  minimumLotAcres: number | null;
  theoreticalLotCount: { value: number | null; calculation: string; approvedYield: false };
  frontageCeiling: { status: string; maxLots: number | null; detail: string };
  obviousMaximumLotConstraint: { value: number | null; from: string };
  /** One line per screen result, in the operator's terms. */
  statements: string[];
}

export type PathKind = 'as_is' | 'minor_subdivision' | 'major_subdivision_entitlement';
export type PathApplicability = 'applies' | 'may_apply' | 'not_applicable' | 'not_established';

export interface DevelopmentPathRead {
  kind: PathKind;
  label: string;
  /** The jurisdiction's own name and definition for the path, verbatim. Null
   *  when the regulation is not retained. */
  localDefinition: { term: string; definition: string; section: string | null; source: DevelopmentSourceRef } | null;
  trigger: string;
  threshold: { statement: string; maxLots: number | null; basis: string };
  authority: string | null;
  reviewBody: string | null;
  materials: Array<{ item: string; requirement: string; section: string | null }>;
  requirements: Array<{ kind: 'plat' | 'survey' | 'access' | 'road' | 'infrastructure' | 'utilities' | 'environmental' | 'bonding_or_dedication' | 'fee' | 'other'; requirement: string; section: string | null; source: string | null }>;
  approvalSteps: string[];
  /** Gates specific to THIS parcel, from the property read and the story. */
  parcelGates: string[];
  applicability: PathApplicability;
  applicabilityWhy: string;
  weight: ClaimWeight;
  /** Only from a retained source or the operator. Null is honest. */
  costAndTime: { estimatedCost: string | null; estimatedTime: string | null; basis: string } | null;
  missingInputs: string[];
  decisiveVerification: { action: string; why: string; askOf: string | null };
  sources: DevelopmentSourceRef[];
}

export interface CriticalGate {
  key: string;
  gate: string;
  why: string;
  decisiveVerification: string;
  blocks: PathKind[];
  weight: ClaimWeight;
}

export interface OperatorPathEstimate {
  path: PathKind;
  estimatedCost: string | null;
  estimatedTime: string | null;
  suppliedBy: string;
  suppliedAt: string | null;
}

export interface ZoningDevelopmentIntelligence {
  contractVersion: typeof ZONING_DEVELOPMENT_INTELLIGENCE_VERSION;
  skill: typeof ZONING_DEVELOPMENT_SKILL;
  dealCardId: number;
  /** Null in the persisted payload; the row's own timestamp is the answer. */
  generatedAt: string | null;
  inputFingerprint: string;
  materialFingerprint: string;
  materialDimensions: Record<string, string>;
  subject: { apn: string | null; county: string | null; state: string | null; acres: number | null; subjectVersion: string | null };
  authority: GoverningAuthorityRead;
  zoning: ZoningDistrictRead;
  uses: StrategyUseRead[];
  standards: DimensionalStandardRead[];
  subjectScreen: SubjectScreen;
  paths: DevelopmentPathRead[];
  criticalGates: CriticalGate[];
  unknowns: string[];
  sourceLineage: DevelopmentSourceRef[];
  currentness: {
    /** The effective or as-of dates the retained sources carry. */
    effectiveDates: Array<{ source: string; date: string }>;
    latestRetrievedAt: string | null;
    statement: string;
    /** The events that make this read refresh; anything else leaves it. */
    refreshOn: string[];
  };
  confidence: ClaimWeight;
  limitations: string[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const clean = (value: unknown): string | null => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text && text !== '-' && text.toLowerCase() !== 'unknown' ? text : null;
};
/** A retained page title can carry raw HTML entities ("&#8211;"); the
 *  operator reads the label, not the markup. */
const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘' };
const decodeEntities = (text: string): string => text
  .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
  .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
  .replace(/&([a-z]+);/gi, (match, name: string) => ENTITY[name.toLowerCase()] ?? match);
const sentence = (text: string): string => (/[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);
const short = (text: string, max = 220): string => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
const WEIGHT_RANK: Record<ClaimWeight, number> = { confirmed: 0, well_supported: 1, likely: 2, unresolved: 3 };
const weaker = (a: ClaimWeight, b: ClaimWeight): ClaimWeight => (WEIGHT_RANK[a] >= WEIGHT_RANK[b] ? a : b);
const asWeight = (value: string | null | undefined): ClaimWeight =>
  value === 'confirmed' || value === 'well_supported' || value === 'likely' ? value : 'unresolved';

const topicOf = (property: PropertyEvidenceSynthesis | null, key: string) =>
  property?.diligence.find((topic) => topic.key === key) ?? null;
const guardOf = (property: PropertyEvidenceSynthesis | null, kind: string) =>
  property?.guardrails.find((guard) => guard.claimKind === kind) ?? null;

const ruleOf = (regulations: SubdivisionRegulations | null, key: SubdivisionRuleKey): SubdivisionRule | null =>
  regulations?.rules.find((rule) => rule.key === key) ?? null;

const ruleSource = (rule: SubdivisionRule, carries: string): DevelopmentSourceRef => ({
  label: decodeEntities(rule.sourceLabel),
  url: rule.sourceUrl,
  tier: rule.confidence === 'likely' ? 'reputable_secondary' : 'official_government_source',
  effectiveOrAsOf: rule.effectiveOrAsOf,
  retrievedAt: null,
  section: rule.section,
  excerpt: decodeEntities(short(rule.quote, 280)) || null,
  carries,
});

const authoritySources = (assignment: AuthorityAssignment, carries: string, retrievedAt: string | null): DevelopmentSourceRef[] =>
  assignment.sources.slice(0, 3).map((source) => ({
    label: decodeEntities(source.label),
    url: source.url,
    tier: source.tier,
    effectiveOrAsOf: null,
    retrievedAt: source.retrievedAt ?? retrievedAt,
    section: null,
    excerpt: decodeEntities(short(source.quote, 200)) || null,
    carries,
  }));

function dedupeSources(sources: DevelopmentSourceRef[]): DevelopmentSourceRef[] {
  const seen = new Set<string>();
  const out: DevelopmentSourceRef[] = [];
  for (const source of sources) {
    const key = `${source.label}|${source.url ?? ''}|${source.section ?? ''}|${source.carries}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(source);
  }
  return out;
}

// ── Governing authority ─────────────────────────────────────────────────────

type BoundaryJurisdiction = ZoningAnalysis['jurisdiction'];

/** What a retained boundary read established about incorporation, from
 *  subject-specific official geometry only. */
function boundaryIncorporation(boundary: BoundaryJurisdiction | null): 'incorporated' | 'unincorporated' | 'unverified' {
  if (!boundary || !boundary.officialBoundaryEvidence) return 'unverified';
  if (/unincorporated/i.test(boundary.incorporationStatus)) return 'unincorporated';
  if (/incorporated_municipality|township/i.test(boundary.incorporationStatus)) return 'incorporated';
  return 'unverified';
}

/** The evidence weight an official boundary determination carries. */
function boundaryWeight(boundary: BoundaryJurisdiction | null): ClaimWeight {
  switch (boundary?.determination) {
    case 'confirmed': return 'confirmed';
    case 'probable': return 'well_supported';
    default: return 'likely';
  }
}

function levelOf(value: string | null | undefined): AuthorityWorkingLevel {
  switch (value) {
    case 'municipal': case 'county': case 'state': case 'joint_municipal_county': case 'special_or_overlay_district':
      return value;
    default:
      return 'unknown';
  }
}

const norm = (value: string | null | undefined): string => String(value ?? '').toLowerCase().replace(/\b(city|town|village|township|county|of|the)\b/g, '').replace(/[^a-z0-9]/g, '');
const sameName = (a: string | null | undefined, b: string | null | undefined): boolean => {
  const x = norm(a); const y = norm(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
};

/**
 * How specifically a retained authority claim reaches THIS parcel.
 *
 *   parcel_specific      the government acted on this parcel in its own
 *                        document, or a source quote carries the subject APN;
 *   jurisdiction_level   a page or code describing the government itself. It
 *                        says who that government is; it never says the parcel
 *                        is inside it. A mailing city, situs locality, ZIP or
 *                        geocoder place name is the same class of evidence.
 */
type ClaimSpecificity = 'parcel_specific' | 'jurisdiction_level';

function claimSpecificity(assignment: AuthorityAssignment, apn: string | null): ClaimSpecificity {
  if (/exercised this function over THIS parcel/i.test(assignment.basis)) return 'parcel_specific';
  const apnKey = String(apn ?? '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (apnKey.length >= 5 && assignment.sources.some((source) => source.quote.replace(/[^a-z0-9]/gi, '').toLowerCase().includes(apnKey))) return 'parcel_specific';
  return 'jurisdiction_level';
}

function governingAuthorityFor(
  authority: ControllingLandUseAuthority | null,
  boundary: BoundaryJurisdiction | null,
  subject: CanonicalSubjectState | null,
  dossier: AcquisitionDossier,
  apn: string | null,
): GoverningAuthorityRead {
  const state = clean(authority?.state) ?? clean(subject?.state) ?? clean(dossier.identity.stateCode);
  // The county is parcel identity: it comes from the accepted subject, never
  // from a page the authority lane discovered.
  const county = clean(subject?.county) ?? clean(dossier.identity.county) ?? clean(authority?.county);
  const countyName = county ? (/county$/i.test(county) ? county : `${county} County`) : null;
  const postalCity = clean(subject?.city) ?? clean(dossier.identity.city) ?? clean(authority?.municipality);
  const boundaryStatus = boundaryIncorporation(boundary);
  const sources: DevelopmentSourceRef[] = [];
  const nonQualifyingClaims: GoverningAuthorityRead['nonQualifyingClaims'] = [];
  const boundaryEvidence = boundary
    ? {
      sourceLabel: 'Official place-boundary geometry against the parcel (U.S. Census Bureau TIGERweb incorporated places and county subdivisions)',
      incorporationStatus: boundary.incorporationStatus,
      controllingAuthorityName: boundary.controllingAuthorityName,
      controllingAuthorityLevel: boundary.controllingAuthorityLevel,
      determination: boundary.determination,
      officialBoundaryEvidence: boundary.officialBoundaryEvidence,
      mailingCityDiffersFromAuthority: boundary.mailingCityDiffersFromAuthority,
      basis: boundary.basis,
    }
    : null;
  if (boundaryEvidence && boundary?.officialBoundaryEvidence) {
    sources.push({
      label: boundaryEvidence.sourceLabel, url: null, tier: 'official_boundary_geography', effectiveOrAsOf: null, retrievedAt: null, section: null,
      excerpt: short(boundary.basis, 240), carries: `subject-specific official boundary: ${boundaryStatus}${boundary.controllingAuthorityName ? `, ${boundary.controllingAuthorityName}` : ''}`,
    });
  }

  const retainedZoning = authority?.zoningAuthority ?? null;
  const retainedSubdivision = authority?.subdivisionAuthority ?? null;
  const retainedName = clean(retainedZoning?.name);
  const retainedLevel = levelOf(retainedZoning?.level);
  const retainedWeight = asWeight(retainedZoning?.determination);
  const retainedAt = retainedZoning?.sources[0]?.retrievedAt ?? authority?.verifiedAt ?? null;
  const specificity: ClaimSpecificity | null = retainedName && retainedZoning ? claimSpecificity(retainedZoning, apn) : null;
  const claimIsMunicipal = retainedLevel === 'municipal' || retainedLevel === 'joint_municipal_county';
  const claimIsCounty = retainedLevel === 'county';
  const countyClaimMatchesSubject = claimIsCounty && sameName(retainedName, countyName);
  const boundaryName = clean(boundary?.controllingAuthorityName) ?? (boundaryStatus === 'unincorporated' ? countyName : null);
  const boundaryBacksClaim = boundaryStatus !== 'unverified'
    && ((claimIsMunicipal && boundaryStatus === 'incorporated' && sameName(retainedName, boundaryName))
      || (countyClaimMatchesSubject && boundaryStatus === 'unincorporated'));

  const retainedSources = retainedZoning ? authoritySources(retainedZoning, `zoning authority: ${retainedName ?? 'unresolved'}`, authority?.verifiedAt ?? null) : [];
  const dismiss = (reason: string): void => {
    if (!retainedName || !retainedZoning) return;
    nonQualifyingClaims.push({
      claim: `${retainedName} administers zoning (${retainedLevel})`,
      level: retainedLevel,
      source: decodeEntities(retainedZoning.sources[0]?.label ?? 'retained authority record'),
      url: retainedZoning.sources[0]?.url ?? null,
      retrievedAt: retainedAt,
      reason,
    });
  };

  let zoning: GoverningAuthorityRead['zoning'];
  let conflict: GoverningAuthorityRead['conflict'] = null;
  let incorporationStatus: GoverningAuthorityRead['incorporationStatus'];
  let municipality: string | null = null;

  if (boundaryStatus !== 'unverified') {
    // Subject-specific official geometry decides. A retained claim either
    // corroborates it, genuinely contradicts it (only when the claim itself
    // reached this parcel), or is a jurisdiction-level page that cannot place
    // the parcel and is retained as a non-qualifying claim.
    // The boundary read speaks the zoning-slice vocabulary (municipality,
    // township, special_district); the working level speaks the authority one.
    const boundaryLevel: AuthorityWorkingLevel = boundaryStatus === 'unincorporated'
      ? 'county'
      : /special/i.test(boundary?.controllingAuthorityLevel ?? '') ? 'special_or_overlay_district' : 'municipal';
    const level = boundaryLevel;
    const contradictsBoundary = !!retainedName && ((claimIsMunicipal && (boundaryStatus === 'unincorporated' || !sameName(retainedName, boundaryName))) || (claimIsCounty && boundaryStatus === 'incorporated'));
    if (boundaryBacksClaim) {
      zoning = {
        name: boundaryName ?? retainedName, level, weight: 'confirmed',
        basis: `${retainedZoning!.basis} The official boundary geometry agrees: the parcel is ${boundaryStatus === 'unincorporated' ? `outside every incorporated place, in unincorporated ${countyName ?? 'county'} jurisdiction` : `inside ${boundaryName}`}.`,
      };
      sources.push(...retainedSources);
    } else if (contradictsBoundary && specificity === 'parcel_specific') {
      zoning = {
        name: boundaryName, level, weight: 'likely',
        basis: `Two subject-specific official sources disagree about who governs; LandOS works against the official boundary geometry (${boundaryName}) until a written determination settles it, and carries the conflict below.`,
      };
      conflict = {
        statement: `${retainedName} acted on this parcel in its own document (${retainedLevel}), but the official place-boundary geometry places the parcel ${boundaryStatus === 'unincorporated' ? `outside every incorporated place, in unincorporated ${countyName ?? 'county'} jurisdiction` : `inside ${boundaryName}`}. Both sources reach this parcel, so the disagreement is genuine.`,
        sides: [
          { claim: `${retainedName} administers zoning (${retainedLevel}); acted on this parcel`, source: decodeEntities(retainedZoning!.sources[0]?.label ?? 'retained authority record'), url: retainedZoning!.sources[0]?.url ?? null, retrievedAt: retainedAt, applicability: 'parcel-specific official document', weight: retainedWeight },
          { claim: `${boundaryName} governs (${level}); parcel is ${boundaryStatus}`, source: boundaryEvidence!.sourceLabel, url: null, retrievedAt: null, applicability: 'parcel geometry against official boundaries', weight: boundaryWeight(boundary) },
        ],
        decisiveVerification: `Obtain a written zoning verification letter from ${boundaryName ?? 'the county'} naming APN ${apn ?? 'the subject'}, and the ${retainedName} planning office's written statement of whether the parcel lies within its corporate limits or planning region; the county property appraiser's taxing-district field for the parcel is the one-step tiebreaker.`,
      };
      sources.push(...retainedSources);
    } else {
      zoning = {
        name: boundaryName, level, weight: boundaryWeight(boundary),
        basis: `Official boundary geometry places the parcel ${boundaryStatus === 'unincorporated' ? `outside every incorporated place, in unincorporated ${countyName ?? 'county'} jurisdiction` : `inside ${boundaryName}`} (${boundary?.determination ?? 'stated'}).${retainedName && contradictsBoundary ? ` The retained ${retainedName} record is a jurisdiction-level source keyed to the postal locality; it cannot place this parcel and is carried below as a non-qualifying claim, not as a conflict.` : ''}`,
      };
      if (contradictsBoundary) {
        dismiss(`A jurisdiction-level page or code names ${retainedName} as administering zoning for itself, but nothing in it reaches APN ${apn ?? 'the subject'}; the match was keyed to the postal locality "${postalCity ?? retainedName}". The subject-specific official boundary places the parcel ${boundaryStatus === 'unincorporated' ? 'outside every incorporated place' : `inside ${boundaryName}`}, so this claim does not qualify.`);
      } else if (retainedName) {
        // A claim that neither corroborates nor contradicts (e.g. a county page
        // for a parcel the boundary places inside a city) is retained as context.
        dismiss(`The retained ${retainedName} record describes a ${retainedLevel}-level government, while the official boundary places the parcel ${boundaryStatus === 'unincorporated' ? 'in unincorporated county jurisdiction' : `inside ${boundaryName}`}; it neither corroborates nor contradicts the boundary at parcel level.`);
      }
    }
    incorporationStatus = boundaryStatus;
    municipality = boundaryStatus === 'incorporated' ? boundaryName : null;
  } else if (retainedName && claimIsMunicipal && specificity === 'parcel_specific') {
    // The government acted on this exact parcel in its own document: that is
    // subject-specific evidence of jurisdiction, and it establishes the
    // parcel as inside that municipality's authority.
    zoning = { name: retainedName, level: retainedLevel, weight: retainedWeight, basis: retainedZoning!.basis };
    sources.push(...retainedSources);
    incorporationStatus = 'incorporated';
    municipality = retainedName;
  } else if (retainedName && countyClaimMatchesSubject) {
    // A county-level page cannot say whether the parcel sits inside one of the
    // county's municipalities. It is carried as the working authority at a
    // reduced weight, with incorporation left unverified rather than inferred.
    zoning = {
      name: retainedName, level: 'county', weight: weaker(retainedWeight, 'likely'),
      basis: `${retainedZoning!.basis} No subject-specific boundary evidence is retained, so whether the parcel lies inside an incorporated place is unverified; the county is carried as the working authority, not inferred as the only one.`,
    };
    sources.push(...retainedSources);
    incorporationStatus = 'unverified';
  } else if (retainedName) {
    // A municipal claim keyed to the postal locality, with nothing that places
    // the parcel inside that municipality. It is not adopted.
    zoning = {
      name: null, level: 'unknown', weight: 'unresolved',
      basis: `The only retained authority claim (${retainedName}, ${retainedLevel}) is a jurisdiction-level source keyed to the postal locality "${postalCity ?? retainedName}"; no subject-specific official boundary or parcel-level act places APN ${apn ?? 'the subject'} inside it. A mailing city, ZIP or geocoder place name cannot establish who governs.`,
    };
    dismiss(`Keyed to the postal locality "${postalCity ?? retainedName}"; no source reaches APN ${apn ?? 'the subject'} and no official boundary read is retained.`);
    incorporationStatus = 'unverified';
  } else {
    zoning = { name: null, level: 'unknown', weight: 'unresolved', basis: 'No controlling-authority record and no official boundary evidence are retained for this parcel.' };
    incorporationStatus = 'unverified';
  }

  const subdivision: GoverningAuthorityRead['subdivision'] = (() => {
    const name = clean(retainedSubdivision?.name);
    if (!name || !retainedSubdivision) return { ...zoning, basis: 'No separate subdivision authority is retained; carried with the zoning authority.' };
    if (zoning.name && sameName(name, zoning.name)) {
      return { name: zoning.name, level: zoning.level, weight: weaker(zoning.weight, asWeight(retainedSubdivision.determination)), basis: retainedSubdivision.basis };
    }
    if (!zoning.name) return { ...zoning, basis: `The retained subdivision authority (${name}) rests on the same non-qualifying basis as the zoning claim; carried with it.` };
    return { ...zoning, basis: `Carried with the zoning authority; the retained subdivision record (${name}) does not qualify at parcel level for the same reason.` };
  })();

  // Special authorities and ETJ / planning areas, from retained references.
  const specialAuthorities = [...new Set((authority?.conflicts ?? [])
    .filter((entry) => /overlay|special planning|historic|redevelopment|landmark|district/i.test(entry))
    .map((entry) => decodeEntities(short(entry.replace(/^An overlay or special planning district is referenced for this jurisdiction:\s*/i, 'Referenced: '), 160))))].slice(0, 4);
  const etjText = [...(authority?.limitations ?? []), ...(authority?.conflicts ?? []), ...(retainedZoning?.sources ?? []).map((source) => source.quote)]
    .find((entry) => /extraterritorial|\bETJ\b|planning area|urban service area/i.test(entry ?? ''));
  const etjOrPlanningArea: GoverningAuthorityRead['etjOrPlanningArea'] = etjText
    ? { status: 'established', statement: decodeEntities(short(etjText, 220)) }
    : { status: 'not_established', statement: 'No retained source addresses an extraterritorial jurisdiction or a planning area for this parcel; none is asserted.' };

  return {
    state, county: countyName, municipalityOrTownship: municipality, incorporationStatus,
    zoning, subdivision,
    planningBody: zoning.name && authority?.planningBody && (sameName(authority.planningBody, zoning.name) || !nonQualifyingClaims.length) ? clean(authority.planningBody) : null,
    etjOrPlanningArea, specialAuthorities, boundaryEvidence, conflict,
    nonQualifyingClaims,
    postalLocality: {
      city: postalCity,
      statement: postalCity
        ? `"${postalCity}" is the postal locality of the subject address; it does not establish municipal, zoning, ETJ or planning authority, and the same ZIP can cross jurisdiction boundaries.`
        : 'No postal locality is retained.',
    },
    sources: dedupeSources(sources),
  };
}

// ── Current zoning ──────────────────────────────────────────────────────────

function zoningDistrictFor(zoning: CurrentZoningDetermination | null, authority: GoverningAuthorityRead): ZoningDistrictRead {
  if (!zoning) {
    return {
      established: false, districtCode: null, districtName: null, overlays: [], evidenceKind: null, parcelMatchBasis: null, effectiveOrAsOf: null,
      weight: 'unresolved', statement: 'No current zoning determination is retained for this parcel.', source: null, historicalReferences: [], limitations: [],
    };
  }
  const source: DevelopmentSourceRef | null = zoning.sourceLabel || zoning.sourceUrl
    ? {
      label: decodeEntities(zoning.sourceLabel ?? 'Official zoning source'), url: zoning.sourceUrl, tier: 'official_government_source',
      effectiveOrAsOf: zoning.effectiveOrAsOf, retrievedAt: zoning.verifiedAt ?? null, section: null,
      excerpt: zoning.parcelMatchBasis ? short(zoning.parcelMatchBasis, 200) : null,
      carries: zoning.established ? `current district ${zoning.districtCode}` : 'zoning attempt, unresolved',
    }
    : null;
  const historical = zoning.historicalReferences.map((reference) => ({
    kind: clean((reference as { kind?: unknown }).kind),
    value: clean((reference as { value?: unknown; district?: unknown }).value ?? (reference as { district?: unknown }).district),
    asOf: clean((reference as { asOf?: unknown; date?: unknown }).asOf ?? (reference as { date?: unknown }).date),
  }));
  const statement = zoning.established
    ? `Current district ${zoning.districtCode}${zoning.districtName ? ` (${zoning.districtName})` : ''} under ${zoning.authorityName ?? authority.zoning.name ?? 'the controlling authority'}, from ${zoning.evidenceKind?.replace(/_/g, ' ') ?? 'an official source'}${zoning.effectiveOrAsOf ? `, ${zoning.effectiveOrAsOf}` : ''}; matched to this parcel by ${zoning.parcelMatchBasis ?? 'the retained basis'}.`
    : `The current zoning district is NOT established: no current, parcel-specific official source names it${historical.length ? `; ${historical.length} historical reference(s) are retained and are not the current district` : ''}.`;
  return {
    established: zoning.established,
    districtCode: zoning.districtCode,
    districtName: zoning.districtName,
    overlays: zoning.overlays,
    evidenceKind: zoning.evidenceKind,
    parcelMatchBasis: zoning.parcelMatchBasis,
    effectiveOrAsOf: zoning.effectiveOrAsOf,
    weight: zoning.established ? asWeight(zoning.confidence) : 'unresolved',
    statement,
    source,
    historicalReferences: historical,
    limitations: zoning.limitations.filter((line) => /UNRESOLVED|not established|no current/i.test(line)).slice(0, 2),
  };
}

// ── Uses relevant to the company's strategies ───────────────────────────────

const STRATEGY_USE_CLASSES: ReadonlyArray<{ key: string; label: string; pattern: RegExp; strategies: StrategyId[] }> = [
  { key: 'single_family_dwelling', label: 'Single-family dwelling', pattern: /single[- ]family|one[- ]family|detached dwelling|\bdwelling\b|residential use|\bresidence\b/i, strategies: ['quick_flip', 'retail_flip', 'subdivision_minor_split', 'builder_sale', 'owner_finance_exit'] },
  { key: 'manufactured_home', label: 'Manufactured or mobile home', pattern: /manufactured|mobile home|modular home/i, strategies: ['land_home_package'] },
  { key: 'accessory_structure', label: 'Accessory structure or use', pattern: /accessory/i, strategies: ['improvement_play'] },
  { key: 'agricultural', label: 'Agricultural use', pattern: /agricultur|\bfarm|crop|livestock|silvicultur|timber/i, strategies: ['quick_flip', 'neighbor_sale'] },
  { key: 'division_of_land', label: 'Division into additional lots', pattern: /subdivi|lot split|division of (?:land|a lot|a parcel)|family division|\bplat\b/i, strategies: ['subdivision_minor_split'] },
];

function usesFor(
  standards: ZoningStandardsResult | null,
  zoning: CurrentZoningDetermination | null,
  district: ZoningDistrictRead,
): StrategyUseRead[] {
  const findings = standards?.established && !standards.contextOnly ? standards.allowedUses : [];
  const principal = (standards?.established ? standards.standards.principalUses : zoning?.standards.principalUses ?? []).filter(Boolean);
  const principalSource = (standards?.established ? standards.standards.sources[0] : zoning?.standards.sources[0]) ?? null;
  const flagSource = principalSource;
  const manufacturedFlag = standards?.established ? standards.standards.manufacturedHomeEligible : zoning?.standards.manufacturedHomeEligible ?? null;
  const residentialFlag = standards?.established ? standards.standards.residentialEligible : zoning?.standards.residentialEligible ?? null;
  const docSource = (label: string, url: string | null, section: string | null, quote: string | null, carries: string): DevelopmentSourceRef => ({
    label: decodeEntities(label), url, tier: 'official_government_source', effectiveOrAsOf: standards?.documents[0]?.adoptedOrAsOf ?? zoning?.effectiveOrAsOf ?? null,
    retrievedAt: standards?.retrievedAt ?? zoning?.verifiedAt ?? null, section, excerpt: quote ? decodeEntities(short(quote, 200)) : null, carries,
  });

  return STRATEGY_USE_CLASSES.map((cls) => {
    const finding = findings.find((entry) => cls.pattern.test(entry.use));
    if (finding) {
      const standing: UseStanding = finding.status === 'permitted' ? 'by_right' : finding.status === 'prohibited' ? 'prohibited' : 'conditional';
      return {
        key: cls.key, label: cls.label, standing, finding: short(finding.use, 160), section: finding.section,
        source: docSource(finding.sourceLabel, finding.sourceUrl, finding.section, finding.quote, `${cls.label}: ${standing.replace(/_/g, ' ')}`),
        strategies: cls.strategies,
        statement: `${cls.label} is ${standing === 'by_right' ? 'permitted by right' : standing === 'prohibited' ? 'prohibited' : `a ${finding.status.replace(/_/g, ' ')} use`} in ${district.districtCode ?? 'the district'}${finding.section ? ` (${finding.section})` : ''}: "${short(finding.use, 120)}".`,
      };
    }
    const principalHit = principal.find((use) => cls.pattern.test(use));
    if (principalHit && district.established) {
      return {
        key: cls.key, label: cls.label, standing: 'by_right', finding: short(principalHit, 160), section: principalSource?.section ?? null,
        source: principalSource ? docSource(principalSource.label, principalSource.url, principalSource.section, principalSource.quote, `${cls.label}: principal use`) : null,
        strategies: cls.strategies,
        statement: `${cls.label} is listed among the district's principal uses: "${short(principalHit, 120)}".`,
      };
    }
    const flag = cls.key === 'manufactured_home' ? manufacturedFlag : cls.key === 'single_family_dwelling' ? residentialFlag : null;
    if (flag != null && district.established) {
      return {
        key: cls.key, label: cls.label, standing: flag ? 'by_right' : 'prohibited', finding: null, section: flagSource?.section ?? null,
        source: flagSource ? docSource(flagSource.label, flagSource.url, flagSource.section, flagSource.quote, `${cls.label}: ${flag ? 'eligible' : 'not eligible'}`) : null,
        strategies: cls.strategies,
        statement: `${cls.label} is ${flag ? 'eligible' : 'not eligible'} in ${district.districtCode ?? 'the district'} per the retained district standards.`,
      };
    }
    return {
      key: cls.key, label: cls.label, standing: 'not_established', finding: null, section: null, source: null, strategies: cls.strategies,
      statement: district.established
        ? `${cls.label} was not located in the retained ordinance text for ${district.districtCode}; it is reported as not established, never as allowed.`
        : `${cls.label} cannot be read until the current district is established.`,
    };
  });
}

// ── Dimensional standards ───────────────────────────────────────────────────

const STANDARD_LABEL: Record<StandardKey, string> = {
  lot_area: 'Minimum lot area / density',
  density: 'Density',
  frontage: 'Minimum road frontage',
  lot_width: 'Minimum lot width',
  setbacks: 'Setbacks',
  height_or_coverage: 'Height or lot coverage',
  road_access: 'Road and access standard',
  utilities: 'Utilities (water, sewer)',
  well_septic: 'Well and septic',
  environmental: 'Environmental and stormwater',
  other: 'Other rules (flag lots, shared driveways, open space, cluster)',
};

function standardsFor(
  standards: ZoningStandardsResult | null,
  zoning: CurrentZoningDetermination | null,
  regulations: SubdivisionRegulations | null,
  district: ZoningDistrictRead,
): DimensionalStandardRead[] {
  const zs = standards?.established && !standards.contextOnly ? standards.standards : zoning?.established ? zoning.standards : null;
  const zsSource = (value: string | null, carries: string): DevelopmentSourceRef | null => {
    if (!zs || !value) return null;
    const source = zs.sources.find((row) => row.quote.includes(value.slice(0, 24))) ?? zs.sources[0] ?? null;
    const doc = standards?.documents[0] ?? null;
    return {
      label: decodeEntities(source?.label ?? doc?.label ?? 'Adopted zoning ordinance'), url: source?.url ?? doc?.url ?? null, tier: 'official_government_source',
      effectiveOrAsOf: doc?.adoptedOrAsOf ?? zoning?.effectiveOrAsOf ?? null, retrievedAt: standards?.retrievedAt ?? zoning?.verifiedAt ?? null,
      section: source?.section ?? null, excerpt: source?.quote ? decodeEntities(short(source.quote, 200)) : null, carries,
    };
  };
  const rows: DimensionalStandardRead[] = [];
  const push = (key: StandardKey, value: string | null, section: string | null, source: DevelopmentSourceRef | null, gap: string) => {
    rows.push({ key, label: STANDARD_LABEL[key], status: value ? 'established' : 'not_established', value, section, source, gap: value ? null : gap });
  };
  const fromRules = (keys: SubdivisionRuleKey[]): { value: string | null; section: string | null; source: DevelopmentSourceRef | null } => {
    const found = keys.map((key) => ruleOf(regulations, key)).filter((rule): rule is SubdivisionRule => !!rule);
    if (!found.length) return { value: null, section: null, source: null };
    const value = found.map((rule) => `${rule.label}: ${short(rule.value, 160)}`).join(' · ');
    return { value, section: found[0].section, source: ruleSource(found[0], found.map((rule) => rule.label).join(', ')) };
  };

  const lotRule = ruleOf(regulations, 'minimum_lot_size');
  const lotArea = zs?.minimumLotSize ?? lotRule?.value ?? null;
  push('lot_area', lotArea, zs?.minimumLotSize ? (zsSource(zs.minimumLotSize, 'minimum lot size')?.section ?? null) : lotRule?.section ?? null,
    zs?.minimumLotSize ? zsSource(zs.minimumLotSize, 'minimum lot size') : lotRule ? ruleSource(lotRule, 'minimum lot size') : null,
    district.established ? `The minimum lot area for ${district.districtCode} has not been read from the adopted code.` : 'Depends on the current district, which is not established.');
  push('density', zs?.density ?? ruleOf(regulations, 'density_rule')?.value ?? null, null, zs?.density ? zsSource(zs.density, 'density') : null, 'No density rule is retained.');
  const frontageRule = ruleOf(regulations, 'minimum_frontage');
  push('frontage', zs?.frontage ?? frontageRule?.value ?? null, frontageRule?.section ?? null,
    zs?.frontage ? zsSource(zs.frontage, 'minimum frontage') : frontageRule ? ruleSource(frontageRule, 'minimum frontage') : null,
    'No minimum frontage is retained from the zoning standards or the subdivision regulations.');
  const widthRule = ruleOf(regulations, 'minimum_lot_width');
  push('lot_width', zs?.lotWidth ?? widthRule?.value ?? null, widthRule?.section ?? null, zs?.lotWidth ? zsSource(zs.lotWidth, 'lot width') : widthRule ? ruleSource(widthRule, 'lot width') : null, 'No minimum lot width is retained.');
  push('setbacks', zs?.setbacks ?? null, null, zs?.setbacks ? zsSource(zs.setbacks, 'setbacks') : null, 'Setbacks have not been read.');
  push('height_or_coverage', zs?.heightOrCoverage ?? null, null, zs?.heightOrCoverage ? zsSource(zs.heightOrCoverage, 'height or coverage') : null, 'Height and coverage have not been read.');
  const road = fromRules(['access_requirement', 'public_private_road_rule', 'new_road_standard', 'road_improvement_requirement', 'cul_de_sac_or_dead_end']);
  push('road_access', road.value, road.section, road.source, 'No road or access standard is retained from the subdivision regulations.');
  const utilities = fromRules(['utilities_requirement', 'sewer_requirement', 'water_requirement']);
  push('utilities', utilities.value, utilities.section, utilities.source, 'No utility requirement is retained.');
  const septic = fromRules(['septic_implication']);
  push('well_septic', septic.value, septic.section, septic.source, 'No septic or well rule is retained; the health department\'s site evaluation governs regardless.');
  const environmental = fromRules(['stormwater_requirement', 'open_space_requirement']);
  push('environmental', environmental.value, environmental.section, environmental.source, 'No stormwater, open-space or environmental review rule is retained.');
  const other = fromRules(['flag_lot_rule', 'shared_driveway_rule', 'easement_or_access_requirement', 'cluster_development']);
  push('other', other.value, other.section, other.source, 'No flag-lot, shared-driveway, easement or cluster rule is retained.');
  return rows;
}

// ── Subject screen ──────────────────────────────────────────────────────────

function subjectScreenFor(
  subject: CanonicalSubjectState | null,
  property: PropertyEvidenceSynthesis | null,
  dossier: AcquisitionDossier,
  read: PropertySubdivisionRead | null,
): SubjectScreen {
  const acres = property?.subject.acres ?? subject?.governingAcreage?.value ?? dossier.identity.acres ?? null;
  const access = topicOf(property, 'access');
  const legalGuard = guardOf(property, 'Legal access');
  const accessEstablished = !legalGuard && access?.status === 'established';
  const wet = clean(dossier.physical.wetlandsPct);
  const wetlandsPct = wet ? Number(wet.replace('%', '')) : null;
  const wellSeptic = topicOf(property, 'well_septic');
  const utilities = topicOf(property, 'utilities');
  const statements: string[] = [];
  if (acres != null) statements.push(`Subject acreage ${acres} ac (${property?.subject.acreageBasis ?? subject?.governingAcreage?.source ?? 'retained basis'}).`);
  statements.push(accessEstablished ? sentence(access!.headline) : (legalGuard?.statement ?? access?.gap ?? 'Legal access is not established.'));
  if (dossier.access.frontageFt != null) statements.push(`Mapped frontage ${dossier.access.frontageFt} ft${dossier.access.roadName ? ` on ${dossier.access.roadName}` : ''}; mapped frontage is not recorded legal access.`);
  if (wetlandsPct != null && Number.isFinite(wetlandsPct)) statements.push(`Mapped wetlands cover ${wetlandsPct}% of the parcel; only a delineation sets the real boundary.`);
  if (clean(dossier.physical.femaFloodZone)) statements.push(`FEMA flood zone ${dossier.physical.femaFloodZone}${dossier.physical.femaCoveragePct ? ` (${dossier.physical.femaCoveragePct} coverage)` : ''}.`);
  if (read) statements.push(read.theoreticalLotCount.value != null
    ? `Theoretical lot count ${read.theoreticalLotCount.value} (${read.theoreticalLotCount.calculation}); arithmetic, never an approved yield.`
    : read.theoreticalLotCount.calculation);
  return {
    acres,
    acreageBasis: property?.subject.acreageBasis ?? subject?.governingAcreage?.source ?? null,
    frontageFt: dossier.access.frontageFt,
    roadName: dossier.access.roadName,
    accessEstablished,
    accessStatement: accessEstablished ? sentence(access!.headline) : (legalGuard?.statement ?? access?.gap ?? 'Legal access is not established.'),
    wetlandsPct: wetlandsPct != null && Number.isFinite(wetlandsPct) ? wetlandsPct : null,
    floodZone: clean(dossier.physical.femaFloodZone),
    buildableAcres: clean(dossier.physical.buildableAcres),
    improvement: clean(dossier.physical.improvement),
    wellSepticStatus: wellSeptic ? `${wellSeptic.status}: ${wellSeptic.headline}` : 'not read',
    utilitiesStatus: utilities ? `${utilities.status}: ${utilities.headline}` : 'not read',
    minimumLotAcres: read?.theoreticalLotCount.inputs.minimumLotAcres ?? null,
    theoreticalLotCount: { value: read?.theoreticalLotCount.value ?? null, calculation: read?.theoreticalLotCount.calculation ?? 'Not calculated: no property-specific subdivision read is retained.', approvedYield: false },
    frontageCeiling: { status: read?.frontageConstraint.status ?? 'unknown', maxLots: read?.frontageConstraint.maxLotsByFrontage ?? null, detail: read?.frontageConstraint.detail ?? 'No frontage read is retained.' },
    obviousMaximumLotConstraint: { value: read?.obviousMaximumLotConstraint.value ?? null, from: read?.obviousMaximumLotConstraint.from ?? 'No lot ceiling is retained.' },
    statements,
  };
}

// ── Development paths ───────────────────────────────────────────────────────

interface PathContext {
  apn: string | null;
  authority: GoverningAuthorityRead;
  district: ZoningDistrictRead;
  uses: StrategyUseRead[];
  standards: DimensionalStandardRead[];
  screen: SubjectScreen;
  regulations: SubdivisionRegulations | null;
  read: PropertySubdivisionRead | null;
  estimates: OperatorPathEstimate[];
}

const standardOf = (rows: DimensionalStandardRead[], key: StandardKey) => rows.find((row) => row.key === key)!;
const useOf = (uses: StrategyUseRead[], key: string) => uses.find((use) => use.key === key)!;

function regulationSources(regulations: SubdivisionRegulations | null, carries: string): DevelopmentSourceRef[] {
  return (regulations?.documents ?? []).slice(0, 3).map((doc) => ({
    label: decodeEntities(doc.label), url: doc.url, tier: doc.tier, effectiveOrAsOf: doc.adoptedOrAsOf, retrievedAt: doc.retrievedAt, section: null,
    excerpt: null, carries: `${carries}${doc.draftOrProposed ? ' (document calls itself draft or proposed)' : ''}`,
  }));
}

function requirementsFromRules(regulations: SubdivisionRegulations | null): DevelopmentPathRead['requirements'] {
  const map: Array<[SubdivisionRuleKey, DevelopmentPathRead['requirements'][number]['kind']]> = [
    ['plat_requirement', 'plat'], ['plat_sequence', 'plat'], ['recording_requirement', 'plat'],
    ['survey_requirement', 'survey'],
    ['access_requirement', 'access'], ['easement_or_access_requirement', 'access'], ['shared_driveway_rule', 'access'], ['flag_lot_rule', 'access'],
    ['public_private_road_rule', 'road'], ['new_road_standard', 'road'], ['road_improvement_requirement', 'road'], ['cul_de_sac_or_dead_end', 'road'],
    ['utilities_requirement', 'utilities'], ['sewer_requirement', 'utilities'], ['water_requirement', 'utilities'], ['septic_implication', 'utilities'],
    ['stormwater_requirement', 'environmental'], ['open_space_requirement', 'environmental'],
    ['review_fee', 'fee'],
  ];
  const out: DevelopmentPathRead['requirements'] = [];
  for (const [key, kind] of map) {
    const rule = ruleOf(regulations, key);
    if (!rule) continue;
    out.push({ kind, requirement: `${rule.label}: ${short(rule.value, 200)}`, section: rule.section, source: rule.sourceLabel });
  }
  // Bonding, surety or dedication only when the regulation's own words say so.
  for (const rule of regulations?.rules ?? []) {
    if (/\bbond|surety|letter of credit|dedicat/i.test(rule.value) && !out.some((row) => row.kind === 'bonding_or_dedication' && row.requirement.includes(short(rule.value, 200)))) {
      out.push({ kind: 'bonding_or_dedication', requirement: `${rule.label}: ${short(rule.value, 200)}`, section: rule.section, source: rule.sourceLabel });
    }
  }
  return out;
}

function approvalStepsFrom(regulations: SubdivisionRegulations | null, read: PropertySubdivisionRead | null): string[] {
  const steps = [...(regulations?.reviewSequence ?? [])];
  for (const key of ['administrative_review', 'planning_commission_review', 'governing_body_approval', 'recording_requirement'] as SubdivisionRuleKey[]) {
    const rule = ruleOf(regulations, key);
    if (rule && !steps.some((step) => step.toLowerCase().includes(rule.label.toLowerCase()))) steps.push(`${rule.label}: ${short(rule.value, 140)}`);
  }
  if (!steps.length && read?.requiredReviewBody) steps.push(`Review by ${read.requiredReviewBody}.`);
  return steps;
}

function materialsFrom(regulations: SubdivisionRegulations | null): DevelopmentPathRead['materials'] {
  const items: DevelopmentPathRead['materials'] = [];
  for (const [key, item] of [['survey_requirement', 'Survey'], ['plat_requirement', 'Plat'], ['plat_sequence', 'Plat sequence'], ['recording_requirement', 'Recording'], ['review_fee', 'Review fee']] as Array<[SubdivisionRuleKey, string]>) {
    const rule = ruleOf(regulations, key);
    if (rule) items.push({ item, requirement: short(rule.value, 200), section: rule.section });
  }
  return items;
}

function costAndTimeFor(kind: PathKind, regulations: SubdivisionRegulations | null, estimates: OperatorPathEstimate[]): DevelopmentPathRead['costAndTime'] {
  const operator = estimates.find((estimate) => estimate.path === kind);
  if (operator && (operator.estimatedCost || operator.estimatedTime)) {
    return { estimatedCost: operator.estimatedCost, estimatedTime: operator.estimatedTime, basis: `Operator-supplied (${operator.suppliedBy}${operator.suppliedAt ? `, ${operator.suppliedAt.slice(0, 10)}` : ''}).` };
  }
  const fee = ruleOf(regulations, 'review_fee');
  if (fee && kind !== 'as_is') {
    return { estimatedCost: `Review fee per the regulation: ${short(fee.value, 120)}`, estimatedTime: null, basis: `${fee.sourceLabel}${fee.section ? ` ${fee.section}` : ''}; fee only, not the survey, engineering or improvement cost.` };
  }
  return null;
}

function pathsFor(ctx: PathContext): DevelopmentPathRead[] {
  const { authority, district, uses, standards, screen, regulations, read, apn } = ctx;
  const subjectRef = apn ? `APN ${apn}` : 'the subject parcel';
  const authorityName = authority.subdivision.name ?? authority.zoning.name ?? 'the controlling authority';
  const zoningAuthorityName = authority.zoning.name ?? 'the controlling authority';
  const dwelling = useOf(uses, 'single_family_dwelling');
  const lotArea = standardOf(standards, 'lot_area');
  const frontage = standardOf(standards, 'frontage');
  const rulesRetained = !!regulations && regulations.rules.length > 0;
  const regsSources = regulationSources(regulations, 'subdivision regulations');
  const zoningGate = `Obtain the current zoning district for ${subjectRef} from ${zoningAuthorityName}'s adopted zoning map or a written zoning verification letter`;
  const regsGate = `Obtain ${authorityName}'s current subdivision / land development regulations (the sections defining its own lot-split, minor and major procedures) from its planning department`;
  const authorityGate = authority.conflict?.decisiveVerification
    ?? (!authority.zoning.name && authority.nonQualifyingClaims.length
      ? `Establish who governs before any code is read: run the official place-boundary check against the parcel geometry for APN ${apn ?? 'the subject'}, or read the county property appraiser's taxing-district field; the retained ${authority.nonQualifyingClaims[0].claim.split(' administers')[0]} claim is keyed to the postal locality and does not qualify.`
      : null);

  // ── As-is ──
  const asIsApplicability: PathApplicability = !district.established
    ? 'not_established'
    : dwelling.standing === 'by_right' ? 'applies' : dwelling.standing === 'prohibited' ? 'not_applicable' : 'may_apply';
  const asIsGates: string[] = [];
  if (!screen.accessEstablished) asIsGates.push(screen.accessStatement);
  if (!/established/.test(screen.wellSepticStatus)) asIsGates.push('Septic feasibility is not established; a health-department site evaluation governs whether a dwelling can be permitted.');
  if (screen.wetlandsPct != null && screen.wetlandsPct >= 40) asIsGates.push(`Mapped wetlands ${screen.wetlandsPct}% shrink the buildable envelope; a delineation sets the real boundary.`);
  const asIs: DevelopmentPathRead = {
    kind: 'as_is',
    label: 'Use or resell as one parcel (no division)',
    localDefinition: null,
    trigger: 'Any exit that keeps the parcel whole: resale, an end-user home site, or a manufactured-home placement.',
    threshold: { statement: 'No subdivision review; only the district\'s use and dimensional rules and the ordinary permit path apply.', maxLots: 1, basis: 'By construction: one parcel stays one parcel.' },
    authority: zoningAuthorityName,
    reviewBody: authority.planningBody,
    materials: [],
    requirements: [
      ...(dwelling.finding ? [{ kind: 'other' as const, requirement: `${dwelling.label}: ${dwelling.statement}`, section: dwelling.section, source: dwelling.source?.label ?? null }] : []),
      ...standards.filter((row) => row.status === 'established' && ['lot_area', 'frontage', 'setbacks', 'well_septic'].includes(row.key)).map((row) => ({ kind: 'other' as const, requirement: `${row.label}: ${row.value}`, section: row.section, source: row.source?.label ?? null })),
    ],
    approvalSteps: district.established ? ['Building or placement permit under the district\'s standards.', 'Health-department septic permit where no sewer serves the parcel.'] : [],
    parcelGates: asIsGates,
    applicability: asIsApplicability,
    applicabilityWhy: !district.established
      ? 'The current district is not established, so no use can be read as by-right for this parcel.'
      : dwelling.standing === 'by_right'
        ? `${dwelling.label} is by right in ${district.districtCode}; the parcel can be used or resold as one lot subject to the parcel gates.`
        : dwelling.standing === 'prohibited'
          ? `${dwelling.label} is prohibited in ${district.districtCode}.`
          : `${dwelling.label} is ${dwelling.standing === 'conditional' ? 'a conditional use' : 'not established'} in ${district.districtCode}; the by-right exit is not proven.`,
    weight: !district.established ? 'unresolved' : weaker(district.weight, dwelling.standing === 'not_established' ? 'unresolved' : 'well_supported'),
    costAndTime: costAndTimeFor('as_is', regulations, ctx.estimates),
    missingInputs: [],
    decisiveVerification: authorityGate && !district.established
      ? { action: authorityGate, why: 'Which government governs decides which map and which code apply; nothing downstream is trustworthy before it.', askOf: authority.zoning.name }
      : !district.established
        ? { action: `${zoningGate}.`, why: 'Every use and dimensional standard depends on the district.', askOf: zoningAuthorityName }
        : dwelling.standing === 'not_established'
          ? { action: `Read the ${district.districtCode} permitted-use table in ${zoningAuthorityName}'s adopted code, or request a written zoning verification letter naming the permitted uses.`, why: 'A use not located is never reported as allowed.', askOf: zoningAuthorityName }
          : !screen.accessEstablished
            ? { action: 'Search the county recorder for a recorded easement, plat dedication or deeded access instrument for the subject; a title commitment is the one-step alternative.', why: 'Mapped frontage is not legal access; every exit prices as landlocked until it is recorded.', askOf: null }
            : { action: 'Order a health-department septic site evaluation or written sewer-availability confirmation.', why: 'It is the last permit gate between a vacant lot and a home site.', askOf: authority.county },
    sources: dedupeSources([...(district.source ? [district.source] : []), ...(dwelling.source ? [dwelling.source] : [])]),
  };

  // ── Minor subdivision, in the jurisdiction's own words ──
  const thresholds = regulations?.thresholds ?? null;
  const minorRule = thresholds?.minorDefinition ?? thresholds?.administrativeSplitThreshold ?? null;
  const maxMinor = thresholds?.statedMaxMinorLots ?? null;
  const minorLocal = minorRule
    ? { term: minorRule.label, definition: short(minorRule.value, 320), section: minorRule.section, source: ruleSource(minorRule, 'local minor / lot-split definition') }
    : null;
  const theoretical = screen.theoreticalLotCount.value;
  let minorApplicability: PathApplicability;
  let minorWhy: string;
  if (!rulesRetained) {
    minorApplicability = 'not_established';
    minorWhy = `No current subdivision regulation is retained for ${authorityName}, so the jurisdiction's own lot-split or minor path, its threshold and its materials are not established. Nothing nationwide is assumed in its place.`;
  } else if (theoretical != null && theoretical < 2) {
    minorApplicability = 'not_applicable';
    minorWhy = `${screen.acres} ac against a minimum lot area of ${lotArea.value} yields fewer than two lots (${screen.theoreticalLotCount.calculation}); a division is not available under the retained standard.`;
  } else if (read?.likelyPath.kind === 'administrative_split' || read?.likelyPath.kind === 'minor_subdivision') {
    minorApplicability = 'may_apply';
    minorWhy = `${read.likelyPath.why} ${theoretical != null ? `Theoretical ceiling ${theoretical} lot(s); ` : ''}the review body's determination, not this arithmetic, sets the yield.`;
  } else if (read?.likelyPath.kind === 'major_subdivision') {
    minorApplicability = 'not_applicable';
    minorWhy = `${read.likelyPath.why} The retained threshold routes this parcel to major review.`;
  } else {
    minorApplicability = 'not_established';
    minorWhy = read?.likelyPath.why ?? 'Rules are retained but the parcel-specific read could not place this parcel on a path.';
  }
  const minorGates = [...(read?.constraints ?? []).map((constraint) => `${constraint.headline} ${constraint.detail}`.trim()), ...asIsGates.filter((gate) => !(read?.constraints ?? []).some((constraint) => /access/i.test(constraint.kind) && /access/i.test(gate)))];
  const minorMissing: string[] = [];
  if (lotArea.status !== 'established') minorMissing.push(lotArea.gap!);
  if (frontage.status !== 'established') minorMissing.push(frontage.gap!);
  const minor: DevelopmentPathRead = {
    kind: 'minor_subdivision',
    label: minorLocal ? `${authorityName}: ${minorLocal.term.replace(/ definition$/i, '')}` : 'Minor subdivision / lot split (local path not yet retained)',
    localDefinition: minorLocal,
    trigger: minorLocal
      ? `Per ${authorityName}'s regulation: ${minorLocal.definition}`
      : rulesRetained ? 'The retained rules do not state a minor or lot-split definition.' : 'Not established: the regulation defining it is not retained.',
    threshold: {
      statement: maxMinor != null ? `Up to ${maxMinor} lot(s) before major review, per the regulation.` : thresholds?.basis ?? 'No threshold is retained.',
      maxLots: maxMinor,
      basis: thresholds?.basis ?? 'No subdivision regulation retained.',
    },
    authority: authorityName,
    reviewBody: read?.requiredReviewBody ?? (ruleOf(regulations, 'administrative_review') ? 'Staff / administrative review' : ruleOf(regulations, 'planning_commission_review') ? 'Planning commission' : authority.planningBody),
    materials: materialsFrom(regulations),
    requirements: requirementsFromRules(regulations),
    approvalSteps: approvalStepsFrom(regulations, read),
    parcelGates: minorGates,
    applicability: minorApplicability,
    applicabilityWhy: minorWhy,
    weight: !rulesRetained ? 'unresolved' : weaker(district.weight, asWeight(read?.likelyPath.basis === 'confirmed' ? 'confirmed' : read?.likelyPath.basis === 'likely' ? 'likely' : 'unresolved')),
    costAndTime: costAndTimeFor('minor_subdivision', regulations, ctx.estimates),
    missingInputs: minorMissing,
    decisiveVerification: authorityGate && !rulesRetained
      ? { action: authorityGate, why: 'The regulation to obtain depends on which government governs.', askOf: authority.subdivision.name }
      : !rulesRetained
        ? { action: `${regsGate}.`, why: 'The local definition, threshold, materials and review body all come from that document; nothing else can stand in for it.', askOf: authorityName }
        : !district.established
          ? { action: `${zoningGate}.`, why: 'The minimum lot area and frontage that decide yield are the district\'s.', askOf: zoningAuthorityName }
          : lotArea.status !== 'established'
            ? { action: `Read the minimum lot area for ${district.districtCode} from ${zoningAuthorityName}'s adopted code.`, why: 'It is the one number that turns acreage into a lot count.', askOf: zoningAuthorityName }
            : frontage.status !== 'established'
              ? { action: `Read the minimum lot frontage for ${district.districtCode} from the adopted code or the subdivision regulation.`, why: 'Frontage is the usual binding constraint on a small tract.', askOf: authorityName }
              : { action: `Ask ${read?.requiredReviewBody ?? `${authorityName} planning staff`} in writing whether ${subjectRef} qualifies for ${minorLocal?.term.replace(/ definition$/i, '') ?? 'the minor path'} and which plat, survey and access materials they will require.`, why: 'A pre-application determination is the smallest step that converts the theoretical count into a review position.', askOf: authorityName },
    sources: dedupeSources([...(minorLocal ? [minorLocal.source] : []), ...regsSources, ...(lotArea.source ? [lotArea.source] : []), ...(frontage.source ? [frontage.source] : [])]),
  };

  // ── Major subdivision / entitlement ──
  const majorRule = thresholds?.majorDefinition ?? null;
  const majorLocal = majorRule
    ? { term: majorRule.label, definition: short(majorRule.value, 320), section: majorRule.section, source: ruleSource(majorRule, 'local major subdivision definition') }
    : null;
  const newRoad = ruleOf(regulations, 'new_road_standard');
  const triggers: string[] = [];
  if (majorLocal) triggers.push(`Per ${authorityName}'s regulation: ${majorLocal.definition}`);
  if (maxMinor != null) triggers.push(`More than ${maxMinor} lot(s).`);
  if (newRoad) triggers.push(`A new road: ${short(newRoad.value, 140)}`);
  let majorApplicability: PathApplicability;
  let majorWhy: string;
  if (!rulesRetained) {
    majorApplicability = 'not_established';
    majorWhy = `No current subdivision regulation is retained for ${authorityName}; what triggers major review, which hearings it needs and what it requires are not established.`;
  } else if (read?.likelyPath.kind === 'major_subdivision') {
    majorApplicability = 'may_apply';
    majorWhy = read.likelyPath.why;
  } else if (majorLocal && /\b(street|road)\b/i.test(majorLocal.definition) && read?.frontageConstraint.maxLotsByFrontage != null && read.frontageConstraint.maxLotsByFrontage < 2 && (theoretical == null || theoretical >= 2)) {
    majorApplicability = 'may_apply';
    majorWhy = `${authorityName}'s own major definition (${majorLocal.section ?? 'retained section'}) is triggered by a new street, and the retained frontage read shows the existing road frontage supports ${read.frontageConstraint.maxLotsByFrontage} lot(s): any division beyond that needs a new street and so meets the local major trigger. ${read.frontageConstraint.detail}`;
  } else if (theoretical != null && maxMinor != null && theoretical <= maxMinor) {
    majorApplicability = 'not_applicable';
    majorWhy = `The theoretical ceiling of ${theoretical} lot(s) sits within the ${maxMinor}-lot minor threshold; major review would only be triggered by a new road or a larger assemblage.`;
  } else if (theoretical != null && theoretical < 2) {
    majorApplicability = 'not_applicable';
    majorWhy = 'The parcel does not yield a second lot under the retained minimum, so no subdivision path of any size applies.';
  } else {
    majorApplicability = 'not_established';
    majorWhy = 'Rules are retained but neither the lot ceiling nor a stated trigger places this parcel on the major path.';
  }
  const major: DevelopmentPathRead = {
    kind: 'major_subdivision_entitlement',
    label: majorLocal ? `${authorityName}: ${majorLocal.term.replace(/ definition$/i, '')}` : 'Major subdivision / entitlement (local path not yet retained)',
    localDefinition: majorLocal,
    trigger: triggers.join(' ') || (rulesRetained ? 'The retained rules do not state a major-subdivision trigger.' : 'Not established: the regulation defining it is not retained.'),
    threshold: { statement: maxMinor != null ? `Above ${maxMinor} lot(s), or whenever the regulation's own major definition is met.` : thresholds?.basis ?? 'No threshold is retained.', maxLots: null, basis: thresholds?.basis ?? 'No subdivision regulation retained.' },
    authority: authorityName,
    reviewBody: ruleOf(regulations, 'governing_body_approval') ? 'Planning commission, then the governing body' : ruleOf(regulations, 'planning_commission_review') ? 'Planning commission' : authority.planningBody,
    materials: materialsFrom(regulations),
    requirements: requirementsFromRules(regulations),
    approvalSteps: approvalStepsFrom(regulations, read),
    parcelGates: minorGates,
    applicability: majorApplicability,
    applicabilityWhy: majorWhy,
    weight: !rulesRetained ? 'unresolved' : weaker(district.weight, 'likely'),
    costAndTime: costAndTimeFor('major_subdivision_entitlement', regulations, ctx.estimates),
    missingInputs: [...minorMissing, ...(ruleOf(regulations, 'stormwater_requirement') ? [] : ['Engineering and stormwater requirements are not retained.']), ...(requirementsFromRules(regulations).some((row) => row.kind === 'bonding_or_dedication') ? [] : ['Bonding, surety and dedication requirements were not located in the retained rules.'])],
    decisiveVerification: !rulesRetained
      ? { action: authorityGate ?? `${regsGate}.`, why: 'Discretionary approvals, hearings, engineering and infrastructure requirements are all defined there.', askOf: authorityName }
      : { action: `Request a pre-application meeting with ${authorityName} planning staff on ${subjectRef} to confirm the review path, hearings, engineering submittals and any dedication or bonding.`, why: 'The smallest step that reveals the discretionary approvals before any engineering is bought.', askOf: authorityName },
    sources: dedupeSources([...(majorLocal ? [majorLocal.source] : []), ...regsSources, ...(newRoad ? [ruleSource(newRoad, 'new road standard')] : [])]),
  };

  return [asIs, minor, major];
}

// ── Critical gates and unknowns ─────────────────────────────────────────────

function criticalGatesFor(authority: GoverningAuthorityRead, district: ZoningDistrictRead, uses: StrategyUseRead[], standards: DimensionalStandardRead[], screen: SubjectScreen, paths: DevelopmentPathRead[]): CriticalGate[] {
  const gates: CriticalGate[] = [];
  const all: PathKind[] = ['as_is', 'minor_subdivision', 'major_subdivision_entitlement'];
  const division: PathKind[] = ['minor_subdivision', 'major_subdivision_entitlement'];
  if (authority.conflict) {
    gates.push({ key: 'authority', gate: 'Which government governs is in conflict', why: authority.conflict.statement, decisiveVerification: authority.conflict.decisiveVerification, blocks: all, weight: 'likely' });
  } else if (!authority.zoning.name) {
    gates.push({ key: 'authority', gate: 'Controlling authority not established', why: authority.zoning.basis, decisiveVerification: authority.nonQualifyingClaims.length ? `Run the official place-boundary check against the parcel geometry, or read the county property appraiser's taxing-district field for APN ${paths[0].decisiveVerification.action.match(/APN\s+([A-Za-z0-9-]+)/)?.[1] ?? 'the subject'}; a mailing city cannot answer it.` : paths[0].decisiveVerification.action, blocks: all, weight: 'unresolved' });
  } else if (authority.incorporationStatus === 'unverified') {
    gates.push({ key: 'incorporation', gate: 'Incorporation status unverified', why: authority.zoning.basis, decisiveVerification: 'An official place-boundary check against the parcel geometry, or the county property appraiser\'s taxing-district field.', blocks: all, weight: 'likely' });
  }
  if (!district.established) {
    gates.push({ key: 'zoning', gate: 'Current zoning district not established', why: district.statement, decisiveVerification: paths[0].decisiveVerification.action, blocks: all, weight: 'unresolved' });
  }
  const dwelling = useOf(uses, 'single_family_dwelling');
  if (district.established && dwelling.standing !== 'by_right') {
    gates.push({ key: 'dwelling_use', gate: `${dwelling.label}: ${dwelling.standing.replace(/_/g, ' ')}`, why: dwelling.statement, decisiveVerification: paths[0].decisiveVerification.action, blocks: all, weight: dwelling.standing === 'prohibited' ? 'confirmed' : 'unresolved' });
  }
  if (!screen.accessEstablished) {
    gates.push({ key: 'access', gate: 'Legal access not established', why: screen.accessStatement, decisiveVerification: 'A recorded easement, plat dedication or deeded access instrument from the county recorder, or a title commitment.', blocks: all, weight: 'unresolved' });
  }
  const minor = paths.find((path) => path.kind === 'minor_subdivision')!;
  if (minor.applicability === 'not_established') {
    gates.push({ key: 'regulations', gate: 'Local subdivision path not established', why: minor.applicabilityWhy, decisiveVerification: minor.decisiveVerification.action, blocks: division, weight: 'unresolved' });
  }
  const lotArea = standardOf(standards, 'lot_area');
  if (district.established && lotArea.status !== 'established') {
    gates.push({ key: 'lot_area', gate: 'Minimum lot area not read', why: lotArea.gap!, decisiveVerification: minor.decisiveVerification.action, blocks: division, weight: 'unresolved' });
  }
  if (!/established/.test(screen.wellSepticStatus)) {
    gates.push({ key: 'septic', gate: 'Septic feasibility not established', why: screen.wellSepticStatus === 'not read' ? 'No well or septic evidence is retained.' : screen.wellSepticStatus, decisiveVerification: 'A health-department septic site evaluation or written sewer-availability confirmation.', blocks: all, weight: 'unresolved' });
  }
  if (screen.wetlandsPct != null && screen.wetlandsPct >= 40) {
    gates.push({ key: 'wetlands', gate: `Mapped wetlands ${screen.wetlandsPct}%`, why: 'A large wet share shrinks the buildable envelope and any lot layout; the mapped share is not a delineation.', decisiveVerification: 'A wetland delineation by a qualified consultant, then jurisdictional confirmation.', blocks: all, weight: 'well_supported' });
  }
  return gates;
}

// ── Material fingerprint ────────────────────────────────────────────────────

function materialDimensionsFor(authority: GoverningAuthorityRead, district: ZoningDistrictRead, uses: StrategyUseRead[], standards: DimensionalStandardRead[], screen: SubjectScreen, paths: DevelopmentPathRead[], regulations: SubdivisionRegulations | null): Record<string, string> {
  const dims: Record<string, string> = {};
  dims.authority = `${authority.zoning.name ?? 'unresolved'} · ${authority.zoning.level} · ${authority.zoning.weight} · ${authority.incorporationStatus}${authority.conflict ? ' · conflict' : ''}${authority.nonQualifyingClaims.length ? ` · ${authority.nonQualifyingClaims.length} non-qualifying claim(s)` : ''}`;
  dims.district = district.established ? `${district.districtCode} · ${district.weight}${district.effectiveOrAsOf ? ` · ${district.effectiveOrAsOf}` : ''}` : 'not established';
  dims.uses = uses.map((use) => `${use.key}=${use.standing}`).join(' ');
  for (const key of ['lot_area', 'frontage', 'lot_width', 'road_access', 'utilities', 'well_septic'] as StandardKey[]) {
    dims[`standard.${key}`] = standardOf(standards, key).value ?? 'not established';
  }
  dims.minorThreshold = regulations?.thresholds.statedMaxMinorLots != null ? String(regulations.thresholds.statedMaxMinorLots) : (regulations?.thresholds.minorDefinition ? short(regulations.thresholds.minorDefinition.value, 80) : 'not established');
  dims.majorDefinition = regulations?.thresholds.majorDefinition ? short(regulations.thresholds.majorDefinition.value, 80) : 'not established';
  for (const path of paths) dims[`path.${path.kind}`] = path.applicability;
  // A sourced or operator-supplied cost or time is a decision input: its
  // arrival or change refreshes the read, exactly as `currentness.refreshOn` says.
  dims.costAndTime = paths.map((path) => `${path.kind}=${path.costAndTime ? `${path.costAndTime.estimatedCost ?? 'cost n/a'} / ${path.costAndTime.estimatedTime ?? 'time n/a'}` : 'none'}`).join(' · ');
  dims.subject = `${screen.acres ?? '?'} ac · frontage ${screen.frontageFt ?? '?'} ft · access ${screen.accessEstablished ? 'established' : 'not established'} · wetlands ${screen.wetlandsPct ?? '?'}% · lots ${screen.theoreticalLotCount.value ?? '?'}`;
  return dims;
}

// ── The synthesis ───────────────────────────────────────────────────────────

export interface ZoningDevelopmentInput {
  dealCardId: number;
  dossier: AcquisitionDossier;
  subject: CanonicalSubjectState | null;
  property: PropertyEvidenceSynthesis | null;
  authority: ControllingLandUseAuthority | null;
  /** The official-boundary jurisdiction read retained by the zoning slice. */
  boundary: BoundaryJurisdiction | null;
  zoning: CurrentZoningDetermination | null;
  standards: ZoningStandardsResult | null;
  regulations: SubdivisionRegulations | null;
  subdivisionRead: PropertySubdivisionRead | null;
  /** Operator-supplied cost or time estimates, when any exist. */
  operatorEstimates?: OperatorPathEstimate[] | null;
}

export function buildZoningDevelopmentIntelligence(input: ZoningDevelopmentInput): ZoningDevelopmentIntelligence {
  const { dossier, property } = input;
  const apn = property?.subject.apn ?? input.subject?.apn ?? dossier.identity.apn ?? null;
  const authority = governingAuthorityFor(input.authority, input.boundary, input.subject, dossier, apn);
  const district = zoningDistrictFor(input.zoning, authority);
  const uses = usesFor(input.standards, input.zoning, district);
  const standards = standardsFor(input.standards, input.zoning, input.regulations, district);
  const screen = subjectScreenFor(input.subject, property, dossier, input.subdivisionRead);
  const paths = pathsFor({ apn, authority, district, uses, standards, screen, regulations: input.regulations, read: input.subdivisionRead, estimates: input.operatorEstimates ?? [] });
  const criticalGates = criticalGatesFor(authority, district, uses, standards, screen, paths);

  const unknowns = [...new Set([
    ...(authority.conflict ? [authority.conflict.statement] : []),
    ...(district.established ? [] : [district.statement]),
    ...uses.filter((use) => use.standing === 'not_established').map((use) => use.statement),
    ...standards.filter((row) => row.status === 'not_established' && ['lot_area', 'frontage', 'road_access', 'well_septic'].includes(row.key)).map((row) => row.gap!),
    ...paths.flatMap((path) => path.missingInputs),
    ...(input.subdivisionRead?.nextAuthoritativeDiligence ?? []).slice(0, 3),
  ])].map(sentence);

  const sourceLineage = dedupeSources([
    ...authority.sources,
    ...(district.source ? [district.source] : []),
    ...uses.flatMap((use) => (use.source ? [use.source] : [])),
    ...standards.flatMap((row) => (row.source ? [row.source] : [])),
    ...paths.flatMap((path) => path.sources),
  ]);
  const effectiveDates = sourceLineage
    .filter((source) => source.effectiveOrAsOf)
    .map((source) => ({ source: source.label, date: source.effectiveOrAsOf! }))
    .filter((entry, index, all) => all.findIndex((other) => other.source === entry.source && other.date === entry.date) === index);
  const retrievedAts = sourceLineage.map((source) => source.retrievedAt).filter((value): value is string => !!value).sort();
  const latestRetrievedAt = retrievedAts.length ? retrievedAts[retrievedAts.length - 1] : null;

  const confidence: ClaimWeight = [authority.zoning.weight, district.weight, ...paths.filter((path) => path.applicability !== 'not_applicable').map((path) => path.weight)]
    .reduce<ClaimWeight>((acc, weight) => weaker(acc, weight), 'confirmed');

  const limitations: string[] = [
    'This is a source-backed development-path screen, not a zoning verification letter, an entitlement opinion, a survey or legal advice; the jurisdiction\'s written determination governs.',
    'A theoretical lot count is arithmetic over the stated minimum lot size; it is never an approved yield.',
    'A use not located in the retained ordinance text is reported as not established, never as allowed.',
    ...(paths.some((path) => path.costAndTime == null) ? ['Cost and time are shown only where a retained source or the operator states them; every other path names them as missing inputs.'] : []),
    ...(input.regulations?.documents.some((doc) => doc.draftOrProposed) ? ['At least one retained regulation document calls itself draft or proposed; it is not current law.'] : []),
    ...(input.standards?.contextOnly ? ['The retained district standards describe a historical district and are context only; they informed no yield here.'] : []),
  ];

  const materialDimensions = materialDimensionsFor(authority, district, uses, standards, screen, paths, input.regulations);
  const materialFingerprint = sha256(JSON.stringify(materialDimensions));
  const inputFingerprint = sha256(JSON.stringify({
    subject: input.subject?.subjectVersion ?? null,
    property: property?.inputFingerprint ?? null,
    authority: input.authority?.verifiedAt ?? null,
    zoning: input.zoning ? `${input.zoning.districtCode ?? 'none'}@${input.zoning.verifiedAt}` : null,
    standards: input.standards?.retrievedAt ?? null,
    regulations: input.regulations?.retrievedAt ?? null,
    read: input.subdivisionRead?.generatedAt ?? null,
    estimates: input.operatorEstimates ?? null,
    materialFingerprint,
  }));

  return {
    contractVersion: ZONING_DEVELOPMENT_INTELLIGENCE_VERSION,
    skill: ZONING_DEVELOPMENT_SKILL,
    dealCardId: input.dealCardId,
    generatedAt: null,
    inputFingerprint,
    materialFingerprint,
    materialDimensions,
    subject: { apn, county: authority.county, state: authority.state, acres: screen.acres, subjectVersion: input.subject?.subjectVersion ?? property?.subject.subjectVersion ?? null },
    authority,
    zoning: district,
    uses,
    standards,
    subjectScreen: screen,
    paths,
    criticalGates,
    unknowns,
    sourceLineage,
    currentness: {
      effectiveDates,
      latestRetrievedAt,
      statement: effectiveDates.length
        ? `Sources carry effective or as-of dates: ${effectiveDates.slice(0, 4).map((entry) => `${entry.source} (${entry.date})`).join('; ')}. An amendment after those dates is not reflected until the land-use lanes re-retrieve.`
        : 'No retained source carries an effective or as-of date; currency rests on the retrieval dates of the land-use products.',
      refreshOn: [
        'A superseding controlling-authority, current-zoning, zoning-standards, subdivision-regulations or property-subdivision read for the accepted subject.',
        'An accepted-subject change (new subject version) or a material Property Story change to access, frontage, wetlands, septic or acreage.',
        'An operator-supplied cost or time estimate for a path.',
      ],
    },
    confidence,
    limitations: limitations.map(sentence),
  };
}
