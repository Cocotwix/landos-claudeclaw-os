// LandOS — NATIONWIDE land use, zoning and by-right subdivision vocabulary.
//
// This module is the contract for the whole engine. It is deliberately
// AUTHORITY-first and never geography-first: nothing here names a county, a
// township or a state, and no downstream module may add one. A jurisdiction is
// a set of resolved authorities plus the rules those authorities actually
// published; the reusable product is the vocabulary and the honest states.
//
// Three doctrines are encoded structurally rather than left to discipline:
//
//   1. NOTHING IS INVENTED. Every legal value carries a citation and a
//      verification status. There is no shape here that can hold a rule
//      without saying who said it. `unverified` is a first-class answer.
//
//   2. ZONING IS NOT CLASSIFICATION. An assessment class, a future-land-use
//      designation and a tax class are separate kinds from adopted zoning and
//      can never be read as one another.
//
//   3. BY RIGHT IS NOT APPROVABLE. Conditional, special and discretionary
//      approval are distinct statuses from by-right, and objective
//      administrative conditions are distinct from both.
//
// No network code and no persistence live here, so the pure resolvers, the
// live lanes and the operator projection can share one vocabulary.

/* ────────────────────────── evidence and sources ─────────────────────── */

/**
 * How authoritative a source is FOR A LEGAL CONCLUSION.
 *
 * The split at the bottom of this list is the important one. A commercial
 * zoning summary, a brokerage page, an unofficial ordinance mirror or an
 * AI-written explainer may be excellent at telling LandOS WHERE the law lives.
 * None of them may establish WHAT the law says when a primary source exists.
 */
export const SOURCE_AUTHORITY_TIERS = [
  'state_statute',
  'state_administrative_code',
  'state_agency',
  'state_attorney_general',
  'county_code',
  'municipal_code',
  'township_code',
  'zoning_ordinance',
  'subdivision_ordinance',
  'zoning_map',
  'planning_department',
  'official_gis',
  'state_dot',
  'health_or_septic_authority',
  'environmental_authority',
  'manufactured_housing_regulator',
  'official_form_or_guidance',
  /** Discovery only. Never establishes a legal conclusion on its own. */
  'secondary_discovery_only',
] as const;
export type SourceAuthorityTier = (typeof SOURCE_AUTHORITY_TIERS)[number];

/** The tiers that may, alone, establish a legal conclusion. */
export const PRIMARY_SOURCE_TIERS: readonly SourceAuthorityTier[] = SOURCE_AUTHORITY_TIERS.filter(
  (tier) => tier !== 'secondary_discovery_only',
);

export function isPrimaryTier(tier: SourceAuthorityTier): boolean {
  return tier !== 'secondary_discovery_only';
}

export const DOCUMENT_FORMATS = [
  'html',
  'pdf_text',
  'pdf_scanned',
  'json_api',
  'plain_text',
  'unknown',
] as const;
export type DocumentFormat = (typeof DOCUMENT_FORMATS)[number];

/**
 * One inspectable source behind one conclusion.
 *
 * `excerpt` is bounded verbatim text so an operator can check the conclusion
 * without leaving LandOS, and so a later reader can tell a real quotation from
 * a paraphrase. It is never a summary written by LandOS.
 */
export interface LegalSourceCitation {
  tier: SourceAuthorityTier;
  /** Operator-readable name of the source. */
  label: string;
  /** Clickable official URL. */
  url: string;
  /** The body that publishes it, when known. */
  publisher: string | null;
  /** Formal citation as the source prints it, e.g. a code section number. */
  citation: string | null;
  /** Bounded verbatim excerpt supporting the conclusion. Never paraphrase. */
  excerpt: string | null;
  format: DocumentFormat;
  /** Effective or last-amended date the source itself states. */
  effectiveDate: string | null;
  retrievedAt: string;
}

/** PART 20 — how confident LandOS is, stated the same way everywhere. */
export const EVIDENCE_QUALITIES = [
  'verified_official',
  'verified_multiple_official',
  'provisional_official',
  'conflicting_official',
  'unverified',
] as const;
export type EvidenceQuality = (typeof EVIDENCE_QUALITIES)[number];

export function evidenceQualityLabel(quality: EvidenceQuality): string {
  switch (quality) {
    case 'verified_official': return 'Verified official';
    case 'verified_multiple_official': return 'Verified — multiple official sources';
    case 'provisional_official': return 'Provisional official';
    case 'conflicting_official': return 'Conflicting official sources';
    case 'unverified': return 'Unverified';
  }
}

/**
 * The single shape every legal value in this engine takes.
 *
 * There is deliberately no way to express "the minimum lot size is 1 acre"
 * without also expressing who says so and how sure LandOS is. A value with no
 * citations is forced to `unverified` by `assertEvidenceIntegrity`.
 */
export interface EvidencedValue<T> {
  value: T | null;
  quality: EvidenceQuality;
  citations: LegalSourceCitation[];
  /** Plain statement of what is missing, when the value is not established. */
  unresolvedReason: string | null;
  /** Verbatim conflicting statements, when two primary sources disagree. */
  conflict: RuleConflict | null;
}

export interface RuleConflict {
  statement: string;
  sides: Array<{ citation: LegalSourceCitation; says: string }>;
}

/* ───────────────────────────── authority stack ───────────────────────── */

/** Every local-government shape the United States actually uses. */
export const GOVERNMENT_UNIT_TYPES = [
  'state',
  'county',
  'parish',
  'borough_census_area',
  'city',
  'town',
  'township',
  'village',
  'borough',
  'municipality',
  'unincorporated_county',
  'planning_jurisdiction',
  'special_district',
  'consolidated_city_county',
  'independent_city',
  'unknown',
] as const;
export type GovernmentUnitType = (typeof GOVERNMENT_UNIT_TYPES)[number];

/** The distinct kinds of control this engine has to resolve separately. */
export const AUTHORITY_ROLES = [
  'state',
  'county',
  'local_unit',
  'zoning',
  'subdivision',
  'septic_health',
  'road_access',
  'building_permit',
  'other',
] as const;
export type AuthorityRole = (typeof AUTHORITY_ROLES)[number];

export function authorityRoleLabel(role: AuthorityRole): string {
  switch (role) {
    case 'state': return 'State';
    case 'county': return 'County';
    case 'local_unit': return 'Local jurisdiction';
    case 'zoning': return 'Zoning authority';
    case 'subdivision': return 'Subdivision authority';
    case 'septic_health': return 'Septic / health authority';
    case 'road_access': return 'Road / access authority';
    case 'building_permit': return 'Building permit authority';
    case 'other': return 'Other authority';
  }
}

export const INCORPORATION_STATUSES = ['incorporated', 'unincorporated', 'unverified'] as const;
export type IncorporationStatus = (typeof INCORPORATION_STATUSES)[number];

/**
 * One resolved authority. `relationship` is how this authority stands to the
 * others — the piece an operator needs when two bodies both have a say.
 */
export interface ResolvedAuthority {
  role: AuthorityRole;
  /** The governing body's name, exactly as the official source states it. */
  name: EvidencedValue<string>;
  unitType: GovernmentUnitType;
  /** How this authority relates to the rest of the stack. Plain language. */
  relationship: string | null;
  /** Official homepage / department page for the operator. */
  officialUrl: string | null;
}

/**
 * PART 1 — the whole authority stack for one parcel.
 *
 * The operator must not have to know who controls zoning before LandOS
 * researches it, so every role is resolved independently rather than inferred
 * from county containment.
 */
export interface AuthorityStack {
  state: ResolvedAuthority;
  county: ResolvedAuthority;
  localUnit: ResolvedAuthority;
  incorporation: EvidencedValue<IncorporationStatus>;
  zoningAuthority: ResolvedAuthority;
  subdivisionAuthority: ResolvedAuthority;
  septicHealthAuthority: ResolvedAuthority;
  roadAccessAuthority: ResolvedAuthority;
  /** Anything else that materially governs this parcel. */
  otherAuthorities: ResolvedAuthority[];
  /** Which supported pattern this stack matched (PART 1 A–G). */
  pattern: AuthorityPattern;
  patternExplanation: string;
}

/** PART 1 — the authority patterns the engine must support nationwide. */
export const AUTHORITY_PATTERNS = [
  /** A. State framework + township/city administers local approval. */
  'state_framework_local_administration',
  /** B. County controls zoning/subdivision in unincorporated territory. */
  'county_unincorporated_control',
  /** C. Municipality zones; county or state controls another aspect. */
  'municipal_zoning_split_control',
  /** D. State law limits or preempts local restriction. */
  'state_preemption_present',
  /** E. No meaningful state framework; local ordinance controls. */
  'local_ordinance_controls',
  /** F. No conventional zoning, but subdivision/access/septic still apply. */
  'no_zoning_other_controls_apply',
  /** G. Overlapping authorities govern different pieces. */
  'overlapping_authorities',
  'unresolved',
] as const;
export type AuthorityPattern = (typeof AUTHORITY_PATTERNS)[number];

export function authorityPatternLabel(pattern: AuthorityPattern): string {
  switch (pattern) {
    case 'state_framework_local_administration': return 'State framework, locally administered';
    case 'county_unincorporated_control': return 'County control in unincorporated territory';
    case 'municipal_zoning_split_control': return 'Municipal zoning with split control';
    case 'state_preemption_present': return 'State law limits local restriction';
    case 'local_ordinance_controls': return 'Local ordinance controls';
    case 'no_zoning_other_controls_apply': return 'No conventional zoning; other controls apply';
    case 'overlapping_authorities': return 'Overlapping authorities';
    case 'unresolved': return 'Authority pattern unresolved';
  }
}

/* ─────────────────────────── rule precedence ─────────────────────────── */

export const RULE_TYPES = [
  'land_division',
  'subdivision_procedure',
  'zoning_district',
  'permitted_use',
  'dimensional_standard',
  'manufactured_housing',
  'access_or_frontage',
  'septic_or_well',
  'plat_or_survey',
  'preemption',
  'other',
] as const;
export type RuleType = (typeof RULE_TYPES)[number];

/**
 * PART 1 — the precedence record for one rule. Persisted so a later reader can
 * see not just what the rule is but how it stands against the other level of
 * government, which is the thing that decides whether it actually binds.
 */
export interface RulePrecedenceRecord {
  authorityLevel: 'state' | 'county' | 'local' | 'federal';
  governingBody: string;
  ruleType: RuleType;
  citation: string | null;
  effectiveDate: string | null;
  /** True when the state rule sets the floor the local rule builds on. */
  stateIsBaseline: boolean;
  /** True when a local rule supplements the state baseline. */
  localSupplementsState: boolean;
  /** True when the local rule is stricter and is authorized to be. */
  localMoreRestrictiveWhereAuthorized: boolean;
  /** True when state law appears to limit what the local unit may do. */
  statePreemptionRelevant: boolean;
  /** Named conflict that a human must settle. */
  unresolvedConflict: string | null;
}

/* ─────────────────────── statewide land-division ─────────────────────── */

export const STATE_FRAMEWORK_STATUSES = ['present', 'not_found', 'not_applicable', 'unverified'] as const;
export type StateFrameworkStatus = (typeof STATE_FRAMEWORK_STATUSES)[number];

export const STATE_FRAMEWORK_KINDS = [
  'land_division_act',
  'subdivision_statute',
  'minor_subdivision_framework',
  'exempt_split_framework',
  'platting_statute',
  'parent_tract_framework',
  'state_lot_split_rule',
  'manufactured_housing_preemption',
  'zoning_enabling_act',
  'other_statewide_land_use_requirement',
] as const;
export type StateFrameworkKind = (typeof STATE_FRAMEWORK_KINDS)[number];

export function stateFrameworkKindLabel(kind: StateFrameworkKind): string {
  switch (kind) {
    case 'land_division_act': return 'Land division act';
    case 'subdivision_statute': return 'Subdivision statute';
    case 'minor_subdivision_framework': return 'Minor subdivision framework';
    case 'exempt_split_framework': return 'Exempt split framework';
    case 'platting_statute': return 'Platting statute';
    case 'parent_tract_framework': return 'Parent tract framework';
    case 'state_lot_split_rule': return 'State lot split rule';
    case 'manufactured_housing_preemption': return 'Manufactured housing preemption';
    case 'zoning_enabling_act': return 'Zoning enabling act';
    case 'other_statewide_land_use_requirement': return 'Other statewide land use requirement';
  }
}

export interface StateFrameworkProvision {
  kind: StateFrameworkKind;
  /** Short statement of the provision, grounded in the citation's excerpt. */
  summary: string;
  citation: LegalSourceCitation;
  /** Whether the provision materially affects THIS subject, and why. */
  materialToSubject: boolean;
  materiality: string;
}

/** PART 2 — what the state itself establishes, resolved before local rules. */
export interface StateLandDivisionFramework {
  state: string;
  status: StateFrameworkStatus;
  provisions: StateFrameworkProvision[];
  /** What authority the state leaves with local government. */
  localAuthorityRetained: EvidencedValue<string>;
  /** Sources searched, so "not found" is inspectable rather than a shrug. */
  sourcesSearched: Array<{ label: string; url: string; outcome: 'read' | 'unreachable' | 'no_provision_found' }>;
  searchedAt: string;
}

/* ──────────────────────────── zoning district ────────────────────────── */

/**
 * What a code value actually IS. Deal 81 proved why this cannot be a boolean:
 * its GIS published "AR" in a field an operator would read as zoning, and it is
 * an assessment classification.
 */
export const CLASSIFICATION_KINDS = [
  'adopted_zoning',
  'assessment_classification',
  'land_use_classification',
  'future_land_use',
  'tax_class',
  'other_non_zoning_classification',
  'unclassified',
] as const;
export type ClassificationKind = (typeof CLASSIFICATION_KINDS)[number];

export function classificationKindLabel(kind: ClassificationKind): string {
  switch (kind) {
    case 'adopted_zoning': return 'Adopted zoning';
    case 'assessment_classification': return 'Assessment classification — not adopted zoning';
    case 'land_use_classification': return 'Land use classification — not adopted zoning';
    case 'future_land_use': return 'Future land use designation — not adopted zoning';
    case 'tax_class': return 'Tax class — not adopted zoning';
    case 'other_non_zoning_classification': return 'Non-zoning classification';
    case 'unclassified': return 'Kind not established';
  }
}

export const ZONING_PRESENCE = [
  'zoning_established',
  'no_conventional_zoning',
  'zoning_unverified',
] as const;
export type ZoningPresence = (typeof ZONING_PRESENCE)[number];

/** PART 4 — the zoning determination for the subject parcel. */
export interface ZoningDetermination {
  presence: ZoningPresence;
  code: EvidencedValue<string>;
  districtName: EvidencedValue<string>;
  /** What the code value IS. Never assumed to be zoning. */
  classificationKind: ClassificationKind;
  /** Whose zoning this is. */
  governingAuthority: string | null;
  /** The source's own caveat, verbatim, when it published one. */
  sourceDisclaimer: string | null;
  effectiveDate: string | null;
  /**
   * Set when the upstream GIS supplied a code that is NOT adopted zoning. The
   * value is retained and labelled rather than discarded, because it is real
   * evidence — just not the evidence an operator would assume.
   */
  nonZoningClassification: {
    code: string;
    description: string | null;
    kind: ClassificationKind;
    sourceUrl: string | null;
  } | null;
}

/* ────────────────────────── uses and structures ──────────────────────── */

/** PART 5 / PART 6 — the structure and use types LandOS evaluates separately. */
export const STRUCTURE_TYPES = [
  'site_built_single_family',
  'modular_home',
  'manufactured_single_wide',
  'manufactured_double_wide',
  'manufactured_multi_section',
  'pre_hud_mobile_home',
  'used_manufactured_home',
  'new_manufactured_home',
  'manufactured_replacement_of_existing',
  'accessory_dwelling_unit',
  'multifamily',
  'agricultural_use',
] as const;
export type StructureType = (typeof STRUCTURE_TYPES)[number];

export function structureTypeLabel(type: StructureType): string {
  switch (type) {
    case 'site_built_single_family': return 'Site-built single-family home';
    case 'modular_home': return 'Modular home';
    case 'manufactured_single_wide': return 'Manufactured home — single-wide';
    case 'manufactured_double_wide': return 'Manufactured home — double-wide';
    case 'manufactured_multi_section': return 'Manufactured home — multi-section';
    case 'pre_hud_mobile_home': return 'Pre-HUD / legacy mobile home';
    case 'used_manufactured_home': return 'Used manufactured home';
    case 'new_manufactured_home': return 'New manufactured home';
    case 'manufactured_replacement_of_existing': return 'Replacement of an existing manufactured home';
    case 'accessory_dwelling_unit': return 'Accessory dwelling unit';
    case 'multifamily': return 'Multifamily';
    case 'agricultural_use': return 'Agricultural use';
  }
}

/** The manufactured-housing subset, which is mandatory nationwide (PART 6). */
export const MANUFACTURED_STRUCTURE_TYPES: readonly StructureType[] = [
  'modular_home',
  'manufactured_single_wide',
  'manufactured_double_wide',
  'manufactured_multi_section',
  'pre_hud_mobile_home',
  'used_manufactured_home',
  'new_manufactured_home',
  'manufactured_replacement_of_existing',
];

/**
 * PART 5 — legal status, normalized.
 *
 * `allowed_by_right_with_objective_conditions` exists because collapsing it
 * into either neighbour is wrong in a way that costs money: it is NOT a
 * discretionary approval, and it is NOT unconditioned.
 */
export const USE_LEGAL_STATUSES = [
  'allowed_by_right',
  'allowed_by_right_with_objective_conditions',
  'conditional_or_special_approval_required',
  'prohibited',
  'lawful_nonconforming_only',
  'unverified',
] as const;
export type UseLegalStatus = (typeof USE_LEGAL_STATUSES)[number];

export function useLegalStatusLabel(status: UseLegalStatus): string {
  switch (status) {
    case 'allowed_by_right': return 'Allowed by right';
    case 'allowed_by_right_with_objective_conditions': return 'Allowed by right with objective conditions';
    case 'conditional_or_special_approval_required': return 'Special / conditional approval required';
    case 'prohibited': return 'Prohibited';
    case 'lawful_nonconforming_only': return 'Lawful nonconforming / replacement only';
    case 'unverified': return 'Unverified';
  }
}

/** True only for the two by-right statuses. Nothing else may be read as by-right. */
export function isByRight(status: UseLegalStatus): boolean {
  return status === 'allowed_by_right' || status === 'allowed_by_right_with_objective_conditions';
}

/** PART 6 — the objective requirement kinds a code may attach to a use. */
export const OBJECTIVE_CONDITION_KINDS = [
  'minimum_lot_area',
  'minimum_lot_width',
  'minimum_road_frontage',
  'setbacks',
  'minimum_dwelling_area',
  'minimum_unit_width',
  'foundation',
  'permanent_affixation',
  'skirting',
  'roof_pitch',
  'exterior_siding_material',
  'porch',
  'orientation',
  'removal_of_transport_gear',
  'hud_label',
  'age_or_construction_year',
  'appearance_standards',
  'installation_standards',
  'owner_occupancy',
  'replacement_restriction',
  'manufactured_home_park_distinction',
  'other',
] as const;
export type ObjectiveConditionKind = (typeof OBJECTIVE_CONDITION_KINDS)[number];

export function objectiveConditionLabel(kind: ObjectiveConditionKind): string {
  switch (kind) {
    case 'minimum_lot_area': return 'Minimum lot area';
    case 'minimum_lot_width': return 'Minimum lot width';
    case 'minimum_road_frontage': return 'Minimum road frontage';
    case 'setbacks': return 'Setbacks';
    case 'minimum_dwelling_area': return 'Minimum dwelling area';
    case 'minimum_unit_width': return 'Minimum unit width';
    case 'foundation': return 'Foundation';
    case 'permanent_affixation': return 'Permanent affixation';
    case 'skirting': return 'Skirting';
    case 'roof_pitch': return 'Roof pitch';
    case 'exterior_siding_material': return 'Exterior siding / material';
    case 'porch': return 'Porch';
    case 'orientation': return 'Orientation';
    case 'removal_of_transport_gear': return 'Removal of transport gear';
    case 'hud_label': return 'HUD label';
    case 'age_or_construction_year': return 'Age / construction year restriction';
    case 'appearance_standards': return 'Appearance standards';
    case 'installation_standards': return 'Installation standards';
    case 'owner_occupancy': return 'Owner occupancy';
    case 'replacement_restriction': return 'Replacement restriction';
    case 'manufactured_home_park_distinction': return 'Manufactured home park distinction';
    case 'other': return 'Other requirement';
  }
}

export interface ObjectiveCondition {
  kind: ObjectiveConditionKind;
  /** The requirement as the ordinance states it, in the ordinance's own words. */
  requirement: string;
  citation: LegalSourceCitation;
}

/** PART 5 / 6 — one use determination. */
export interface UseDetermination {
  structureType: StructureType;
  status: UseLegalStatus;
  quality: EvidenceQuality;
  citations: LegalSourceCitation[];
  conditions: ObjectiveCondition[];
  /** Why the status is what it is, in plain language. */
  reasoning: string;
  /** What must be checked before this can be relied on. */
  unresolvedReason: string | null;
  /**
   * PART 6 — whether STATE law limits what the local unit may do about this
   * structure type. Resolved, never assumed in either direction.
   */
  statePreemption: StatePreemptionFinding | null;
}

export const PREEMPTION_EFFECTS = [
  /** State law bars the local unit from excluding this structure type. */
  'local_exclusion_barred',
  /** State law allows local regulation but only on stated objective grounds. */
  'local_regulation_limited_to_objective_standards',
  /** State law expressly leaves the decision to the local unit. */
  'local_authority_preserved',
  /** A state statute exists and its effect on this question is not established. */
  'effect_unresolved',
  /** No state provision was located. */
  'no_state_provision_found',
] as const;
export type PreemptionEffect = (typeof PREEMPTION_EFFECTS)[number];

export interface StatePreemptionFinding {
  effect: PreemptionEffect;
  statement: string;
  citations: LegalSourceCitation[];
  /** How the state provision and the local ordinance stand together. */
  interaction: string;
}

/**
 * PART 6 — private restrictions, kept structurally apart from zoning so they
 * can never be presented as governmental land-use law.
 */
export const PRIVATE_RESTRICTION_STATUSES = ['verified', 'reported', 'unverified', 'not_researched'] as const;
export type PrivateRestrictionStatus = (typeof PRIVATE_RESTRICTION_STATUSES)[number];

export interface PrivateRestrictionFinding {
  status: PrivateRestrictionStatus;
  kind: 'deed_restriction' | 'hoa' | 'subdivision_covenant' | 'architectural_restriction' | 'recorded_private_restriction' | 'unknown';
  statement: string;
  sourceUrl: string | null;
}

/* ──────────────────────── dimensional standards ──────────────────────── */

export const DIMENSIONAL_STANDARD_KINDS = [
  'minimum_lot_area',
  'minimum_lot_width',
  'minimum_road_frontage',
  'front_setback',
  'side_setback',
  'rear_setback',
  'maximum_density',
  'maximum_lot_coverage',
  'maximum_height',
  'minimum_dwelling_size',
  'access_requirement',
  'corner_lot_rule',
  'flag_lot_dimensional_rule',
  'special_division_standard',
] as const;
export type DimensionalStandardKind = (typeof DIMENSIONAL_STANDARD_KINDS)[number];

export function dimensionalStandardLabel(kind: DimensionalStandardKind): string {
  switch (kind) {
    case 'minimum_lot_area': return 'Minimum lot area';
    case 'minimum_lot_width': return 'Minimum lot width';
    case 'minimum_road_frontage': return 'Minimum road frontage';
    case 'front_setback': return 'Front setback';
    case 'side_setback': return 'Side setback';
    case 'rear_setback': return 'Rear setback';
    case 'maximum_density': return 'Maximum density';
    case 'maximum_lot_coverage': return 'Maximum lot coverage';
    case 'maximum_height': return 'Maximum height';
    case 'minimum_dwelling_size': return 'Minimum dwelling size';
    case 'access_requirement': return 'Access requirement';
    case 'corner_lot_rule': return 'Corner lot rule';
    case 'flag_lot_dimensional_rule': return 'Flag lot dimensional rule';
    case 'special_division_standard': return 'Special frontage / acreage standard';
  }
}

/**
 * PART 7 — one dimensional standard.
 *
 * `originalTerm` is retained beside the normalized kind because jurisdictions
 * with unusual regulatory models get misrepresented when their own vocabulary
 * is thrown away. A code that says "minimum street frontage of a flag lot
 * staff" must still read that way to the operator.
 */
export interface DimensionalStandard {
  kind: DimensionalStandardKind;
  /** The ordinance's own term for this standard. */
  originalTerm: string;
  /** The requirement exactly as stated, units included. */
  statedValue: string;
  /** Numeric value when the standard is cleanly numeric. Null otherwise. */
  numericValue: number | null;
  unit: 'acres' | 'square_feet' | 'feet' | 'percent' | 'units_per_acre' | 'other' | null;
  citation: LegalSourceCitation;
  /** Notes such as "applies only where public sewer is unavailable". */
  qualifier: string | null;
}

/* ───────────────────────── subdivision framework ─────────────────────── */

export const SUBDIVISION_PATH_KINDS = [
  'exempt_split',
  'administrative_subdivision',
  'minor_subdivision',
  'lot_line_adjustment',
  'family_division',
  'land_division',
  'major_subdivision',
  'resubdivision',
  'unresolved',
] as const;
export type SubdivisionPathKind = (typeof SUBDIVISION_PATH_KINDS)[number];

export function subdivisionPathLabel(kind: SubdivisionPathKind): string {
  switch (kind) {
    case 'exempt_split': return 'Exempt split';
    case 'administrative_subdivision': return 'Administrative subdivision';
    case 'minor_subdivision': return 'Minor subdivision';
    case 'lot_line_adjustment': return 'Lot line adjustment';
    case 'family_division': return 'Family division';
    case 'land_division': return 'Land division';
    case 'major_subdivision': return 'Major subdivision';
    case 'resubdivision': return 'Resubdivision';
    case 'unresolved': return 'Subdivision path unresolved';
  }
}

export const REVIEW_PATHS = [
  'administrative_staff_review',
  'planning_commission_review',
  'governing_board_review',
  'combined_administrative_and_commission',
  'unresolved',
] as const;
export type ReviewPath = (typeof REVIEW_PATHS)[number];

export function reviewPathLabel(path: ReviewPath): string {
  switch (path) {
    case 'administrative_staff_review': return 'Administrative staff review';
    case 'planning_commission_review': return 'Planning commission review';
    case 'governing_board_review': return 'Governing board review';
    case 'combined_administrative_and_commission': return 'Administrative review, then planning commission';
    case 'unresolved': return 'Review path unresolved';
  }
}

/**
 * PART 8 — one available division path.
 *
 * `isByRight` is computed, never asserted: it is true only when the path
 * requires no rezoning, variance, special use, conditional use, legislative
 * approval or other discretionary entitlement. Administrative review, a
 * survey, a plat, a septic permit, a driveway permit and recording are all
 * objective approvals and do NOT make a path discretionary.
 */
export interface SubdivisionPath {
  kind: SubdivisionPathKind;
  /** The ordinance's own name for the procedure. */
  originalTerm: string;
  definition: EvidencedValue<string>;
  /** Maximum lots this procedure allows, when the ordinance states one. */
  maximumLots: EvidencedValue<number>;
  /** Maximum lots achievable without creating a new road. */
  maximumLotsWithoutNewRoad: EvidencedValue<number>;
  acreageThreshold: EvidencedValue<string>;
  reviewPath: ReviewPath;
  isByRight: boolean;
  /** The discretionary approvals this path requires, if any. */
  discretionaryApprovals: string[];
  /** The objective approvals it requires. These do not defeat by-right. */
  objectiveApprovals: string[];
  citations: LegalSourceCitation[];
}

/** PART 9 — whether a legal lot count depends on history LandOS does not hold. */
export interface ParentTractFramework {
  /** Whether legal yield depends on prior division activity at all. */
  applies: EvidencedValue<boolean>;
  parentTractDefinition: EvidencedValue<string>;
  lookbackPeriod: EvidencedValue<string>;
  priorDivisionCountRule: EvidencedValue<string>;
  remainderTreatment: EvidencedValue<string>;
  /**
   * True when the rule needs history LandOS cannot see. When this is true no
   * precise legal maximum may be published — only a provisional one.
   */
  priorDivisionHistoryRequired: boolean;
  /** The exact verification step this creates. */
  requiredVerificationStep: string | null;
}

/** PART 8 — the local land-division rule set. */
export interface SubdivisionFramework {
  /** Which body's ordinance this is. */
  governingBody: string | null;
  ordinanceLabel: string | null;
  ordinanceUrl: string | null;
  subdivisionDefinition: EvidencedValue<string>;
  paths: SubdivisionPath[];
  parentTract: ParentTractFramework;
  /** Standards that gate any resulting lot. */
  minimumLotArea: EvidencedValue<string>;
  minimumLotWidth: EvidencedValue<string>;
  minimumRoadFrontage: EvidencedValue<string>;
  flagLots: EvidencedValue<string>;
  sharedDriveways: EvidencedValue<string>;
  privateRoads: EvidencedValue<string>;
  publicRoadFrontageRequired: EvidencedValue<boolean>;
  newRoadTrigger: EvidencedValue<string>;
  surveyRequirement: EvidencedValue<string>;
  platRequirement: EvidencedValue<string>;
  recordingRequirement: EvidencedValue<string>;
  utilityRequirement: EvidencedValue<string>;
  septicRequirement: EvidencedValue<string>;
  wellRequirement: EvidencedValue<string>;
  stormwaterRequirement: EvidencedValue<string>;
  fireAccessRequirement: EvidencedValue<string>;
  applicationFee: EvidencedValue<string>;
  publishedReviewTimeline: EvidencedValue<string>;
  stateHighwayAccessImplication: EvidencedValue<string>;
}

/** The exact label county fallback rules must always carry to an operator. */
export const COUNTY_SUBDIVISION_FALLBACK_LABEL =
  'County fallback rules — controlling local jurisdiction not yet confirmed';

/** The blocker that stays attached for as long as the fallback is in use. */
export const COUNTY_SUBDIVISION_FALLBACK_BLOCKER =
  'Controlling local jurisdiction not yet confirmed';

/**
 * PART 8b — the county's own minor-subdivision / land-division rules, retrieved
 * as a MANDATORY fallback when official-source research could not establish
 * which body actually approves land division for the subject.
 *
 * It exists so an operator is never handed only "unknown". It is explicitly NOT
 * a jurisdiction finding: the county is not asserted to control, the blocker
 * stays attached, and the attempt trail records which authorities were checked
 * and why the question remained open. When the real authority is later
 * confirmed, its rules replace this entirely.
 */
export interface CountySubdivisionFallback {
  label: typeof COUNTY_SUBDIVISION_FALLBACK_LABEL;
  blocker: typeof COUNTY_SUBDIVISION_FALLBACK_BLOCKER;
  county: string | null;
  state: string | null;
  /** The county rule set, extracted by the same parsers as a local ordinance. */
  framework: SubdivisionFramework;
  /** Which authorities were checked, and what each returned. */
  authorityAttempts: string[];
  /** Every source read for the county rules. */
  sources: LegalSourceCitation[];
  /** One plain-language line an operator can act on. */
  summary: string;
  retrievedAt: string;
}

/* ───────────────────────────── access / DOT ──────────────────────────── */

export const ACCESS_STATUSES = [
  'existing_access_verified',
  'new_access_permit_dependent',
  'new_access_unverified',
  'access_constraint_identified',
] as const;
export type AccessStatus = (typeof ACCESS_STATUSES)[number];

export function accessStatusLabel(status: AccessStatus): string {
  switch (status) {
    case 'existing_access_verified': return 'Existing access verified';
    case 'new_access_permit_dependent': return 'New access is permit-dependent';
    case 'new_access_unverified': return 'New access unverified';
    case 'access_constraint_identified': return 'Access constraint identified';
  }
}

export const ROAD_TYPES = [
  'state_highway',
  'us_highway',
  'county_road',
  'city_street',
  'township_road',
  'private_road',
  'unverified',
] as const;
export type RoadType = (typeof ROAD_TYPES)[number];

/** PART 10 / PART 11 — frontage, access, and state-highway involvement. */
export interface AccessFramework {
  roadType: EvidencedValue<RoadType>;
  roadName: string | null;
  /** The authority that controls a new access point on this road. */
  accessAuthority: ResolvedAuthority | null;
  status: AccessStatus;
  drivewayPermitRequired: EvidencedValue<boolean>;
  newAccessApprovalRequired: EvidencedValue<boolean>;
  spacingStandards: EvidencedValue<string>;
  sharedAccessMayBeRequired: EvidencedValue<boolean>;
  subdivisionTriggersReview: EvidencedValue<boolean>;
  /**
   * Always explicit. Visible frontage is never treated as guaranteed legal
   * access, and a future curb cut is never treated as approved.
   */
  constraintNotes: string[];
}

/* ─────────────────────────── septic and well ─────────────────────────── */

/** PART 12 — the onsite wastewater and well picture, at screening depth only. */
export interface SepticWellFramework {
  authority: ResolvedAuthority | null;
  perLotApprovalRequired: EvidencedValue<boolean>;
  divisionRequiresHealthReview: EvidencedValue<boolean>;
  minimumAcreageForOnsiteSystem: EvidencedValue<string>;
  reserveFieldRequirement: EvidencedValue<string>;
  existingSepticInfluence: string | null;
  existingWellInfluence: string | null;
  unresolved: string[];
  /**
   * Fixed statement of scope. This sprint performs no engineered feasibility
   * and no soil interpretation; the field exists so the operator is told.
   */
  scopeNote: string;
}

/* ───────────────────────────── subject yield ─────────────────────────── */

export const YIELD_STATUSES = ['established', 'provisional', 'unresolved'] as const;
export type YieldStatus = (typeof YIELD_STATUSES)[number];

export interface LegalYield {
  status: YieldStatus;
  /** Null whenever status is not `established`. Never a filled-in guess. */
  maximumLots: number | null;
  /** The path the maximum assumes. */
  path: SubdivisionPathKind | null;
  /** Every constraint that was applied, with the value used. */
  constraintsApplied: Array<{ constraint: string; value: string; source: string }>;
  /** Every input that is required and missing. */
  missingInputs: string[];
  reason: string;
}

export interface PhysicalYield {
  status: YieldStatus;
  plausibleLots: number | null;
  /** Subject evidence actually used, so the screening is inspectable. */
  evidenceUsed: Array<{ factor: string; observation: string; source: string }>;
  limitingFactors: string[];
  /** Fixed statement: planning-level screening, not survey or engineering. */
  scopeNote: string;
}

export const SCENARIO_SUPPORT = [
  'supported_for_comp_research',
  'requires_verification',
  'not_currently_supported',
] as const;
export type ScenarioSupport = (typeof SCENARIO_SUPPORT)[number];

export function scenarioSupportLabel(support: ScenarioSupport): string {
  switch (support) {
    case 'supported_for_comp_research': return 'Supported for comp research';
    case 'requires_verification': return 'Requires verification';
    case 'not_currently_supported': return 'Not currently supported';
  }
}

/** PART 17 — one house/improvement carveout concept. */
export interface CarveoutConcept {
  /** Acreage retained with the improvements. */
  retainedAcres: number;
  /** Where the size came from: an operator concept or an ordinance minimum. */
  basis: 'ordinance_minimum' | 'standard_increment' | 'seller_discussed';
  viability: 'plausible' | 'conflicts_with_known_rule' | 'unverified';
  /** The rules and site facts that were checked against it. */
  checks: Array<{ factor: string; outcome: 'satisfied' | 'conflict' | 'unknown'; detail: string }>;
  eliminationReason: string | null;
}

/** PART 16 / PART 18 — one candidate scenario handed downstream. */
export interface LandUseScenario {
  name: string;
  support: ScenarioSupport;
  legalStatus: string;
  resultingLotCount: number | null;
  /** Approximate acreage bands, never survey-grade boundaries. */
  acreageBands: string[];
  improvementStatus: string;
  siteBuiltStatus: UseLegalStatus;
  modularStatus: UseLegalStatus;
  manufacturedSingleWideStatus: UseLegalStatus;
  manufacturedDoubleWideStatus: UseLegalStatus;
  accessConstraint: string;
  subdivisionPath: string;
  remainingVerification: string[];
  /** PART 18 — the concrete comp research this scenario asks for. */
  compsResearchRequest: CompsResearchRequest;
}

export interface CompsResearchRequest {
  /** One line per comp set the downstream department should run. */
  requests: Array<{
    label: string;
    propertyKind: 'improved_residential' | 'vacant_land' | 'manufactured_eligible_land';
    acreageBand: string;
    status: 'closed' | 'active' | 'both';
    /** Why this set is material to the scenario. */
    rationale: string;
  }>;
  /** True only when every request rests on a verified legal conclusion. */
  restsOnVerifiedLaw: boolean;
}

/* ───────────────────────── discovery-call handoff ────────────────────── */

/** PART 25 — a question generated from a real unresolved property fact. */
export interface DiscoveryQuestion {
  question: string;
  /** The unresolved item that produced it. */
  because: string;
  /** What the answer would unblock. */
  unblocks: string;
  /** Seller answers are never legal verification. Fixed. */
  answerStatus: 'seller_reported';
}

/* ─────────────────────────── failure states ──────────────────────────── */

/** PART 24 — honest states. Nothing here is papered over. */
export const LAND_USE_FAILURE_STATES = [
  'ZONING_AUTHORITY_UNRESOLVED',
  'SUBDIVISION_AUTHORITY_UNRESOLVED',
  'NO_CONVENTIONAL_ZONING_VERIFIED',
  'ZONING_DISTRICT_UNVERIFIED',
  'STATE_FRAMEWORK_NOT_FOUND',
  'MINOR_SUBDIVISION_THRESHOLD_UNVERIFIED',
  'PRIOR_DIVISION_HISTORY_REQUIRED',
  'MANUFACTURED_SINGLE_WIDE_STATUS_UNVERIFIED',
  'MANUFACTURED_DOUBLE_WIDE_STATUS_UNVERIFIED',
  'SEPTIC_AUTHORITY_UNRESOLVED',
  'STATE_HIGHWAY_ACCESS_PERMIT_REQUIRED',
  'RULE_CONFLICT_REQUIRES_VERIFICATION',
  'PAID_ACCESS_REQUIRES_OPERATOR_APPROVAL',
  'EMAIL_VERIFICATION_REQUIRED',
  'ORDINANCE_DOCUMENT_UNREADABLE',
  'ORDINANCE_SOURCE_NOT_FOUND',
  'LEGAL_MAXIMUM_UNRESOLVED',
  'SUBJECT_IDENTITY_UNRESOLVED',
] as const;
export type LandUseFailureState = (typeof LAND_USE_FAILURE_STATES)[number];

export function landUseFailureLabel(state: LandUseFailureState): string {
  switch (state) {
    case 'ZONING_AUTHORITY_UNRESOLVED': return 'Zoning authority unresolved';
    case 'SUBDIVISION_AUTHORITY_UNRESOLVED': return 'Subdivision authority unresolved';
    case 'NO_CONVENTIONAL_ZONING_VERIFIED': return 'No conventional zoning — verified';
    case 'ZONING_DISTRICT_UNVERIFIED': return 'Zoning district unverified';
    case 'STATE_FRAMEWORK_NOT_FOUND': return 'State framework not found';
    case 'MINOR_SUBDIVISION_THRESHOLD_UNVERIFIED': return 'Minor subdivision threshold unverified';
    case 'PRIOR_DIVISION_HISTORY_REQUIRED': return 'Prior division history required';
    case 'MANUFACTURED_SINGLE_WIDE_STATUS_UNVERIFIED': return 'Manufactured single-wide status unverified';
    case 'MANUFACTURED_DOUBLE_WIDE_STATUS_UNVERIFIED': return 'Manufactured double-wide status unverified';
    case 'SEPTIC_AUTHORITY_UNRESOLVED': return 'Septic authority unresolved';
    case 'STATE_HIGHWAY_ACCESS_PERMIT_REQUIRED': return 'State highway access permit required';
    case 'RULE_CONFLICT_REQUIRES_VERIFICATION': return 'Rule conflict — requires verification';
    case 'PAID_ACCESS_REQUIRES_OPERATOR_APPROVAL': return 'Paid access requires operator approval';
    case 'EMAIL_VERIFICATION_REQUIRED': return 'Email verification required';
    case 'ORDINANCE_DOCUMENT_UNREADABLE': return 'Ordinance document unreadable';
    case 'ORDINANCE_SOURCE_NOT_FOUND': return 'Ordinance source not found';
    case 'LEGAL_MAXIMUM_UNRESOLVED': return 'Legal maximum unresolved';
    case 'SUBJECT_IDENTITY_UNRESOLVED': return 'Subject identity unresolved';
  }
}

/* ──────────────────────────── the whole result ───────────────────────── */

export interface LandUseSubject {
  dealCardId: number;
  parcelId: string | null;
  address: string | null;
  city: string | null;
  county: string | null;
  state: string | null;
  acres: number | null;
  latitude: number | null;
  longitude: number | null;
  /** True when the parcel carries improvements LandOS knows about. */
  hasImprovements: boolean;
  /** Seller-reported facts, retained AS seller-reported. */
  sellerReported: string[];
}

/** PART 14 — one research lane's outcome, persisted as it completes. */
export const LAND_USE_LANES = [
  'state_framework',
  'zoning_authority',
  'local_zoning_ordinance',
  'local_subdivision_ordinance',
  'manufactured_housing_law',
  'dot_access',
  'septic_health',
] as const;
export type LandUseLane = (typeof LAND_USE_LANES)[number];

export function landUseLaneLabel(lane: LandUseLane): string {
  switch (lane) {
    case 'state_framework': return 'State law / statewide framework';
    case 'zoning_authority': return 'Zoning authority';
    case 'local_zoning_ordinance': return 'Local zoning ordinance';
    case 'local_subdivision_ordinance': return 'Local subdivision ordinance';
    case 'manufactured_housing_law': return 'Manufactured housing law';
    case 'dot_access': return 'DOT / access';
    case 'septic_health': return 'Septic / health authority';
  }
}

export interface LaneOutcome {
  lane: LandUseLane;
  status: 'complete' | 'partial' | 'no_source_found' | 'unreachable' | 'blocked_paid' | 'not_run';
  detail: string;
  sourcesRead: number;
  durationMs: number;
}

/** The complete land-use determination for one property. */
export interface LandUseDetermination {
  version: 1;
  subject: LandUseSubject;
  authority: AuthorityStack;
  stateFramework: StateLandDivisionFramework;
  zoning: ZoningDetermination;
  uses: UseDetermination[];
  privateRestrictions: PrivateRestrictionFinding[];
  dimensionalStandards: DimensionalStandard[];
  subdivision: SubdivisionFramework;
  /**
   * Set ONLY when the governing land-division authority stayed unresolved after
   * official-source research. Never controlling; always labelled.
   */
  countySubdivisionFallback?: CountySubdivisionFallback | null;
  access: AccessFramework;
  septicWell: SepticWellFramework;
  precedence: RulePrecedenceRecord[];
  legalYield: LegalYield;
  physicalYield: PhysicalYield;
  carveouts: CarveoutConcept[];
  scenarios: LandUseScenario[];
  discoveryQuestions: DiscoveryQuestion[];
  /** Every unresolved item, in one place, in plain language. */
  unresolved: string[];
  failureStates: LandUseFailureState[];
  /** Every distinct authoritative source read, deduplicated by URL. */
  sources: LegalSourceCitation[];
  lanes: LaneOutcome[];
  determinedAt: string;
}

/* ───────────────────────────── constructors ──────────────────────────── */

/** An unresolved evidenced value. The default state of every legal field. */
export function unresolvedValue<T>(reason: string): EvidencedValue<T> {
  return { value: null, quality: 'unverified', citations: [], unresolvedReason: reason, conflict: null };
}

/**
 * An evidenced value backed by real citations.
 *
 * The quality is DERIVED from the citations rather than supplied, which is why
 * there is no way to claim `verified_official` without a primary source behind
 * it. Secondary sources alone can never lift a value above `unverified`.
 */
export function evidencedValue<T>(value: T, citations: LegalSourceCitation[], conflict: RuleConflict | null = null): EvidencedValue<T> {
  const primaries = citations.filter((citation) => isPrimaryTier(citation.tier));
  if (conflict) {
    return { value, quality: 'conflicting_official', citations, unresolvedReason: conflict.statement, conflict };
  }
  if (primaries.length === 0) {
    return {
      value: null,
      quality: 'unverified',
      citations,
      unresolvedReason: 'Only secondary sources were available; a primary source is required for a legal conclusion.',
      conflict: null,
    };
  }
  const distinctPrimaryUrls = new Set(primaries.map((citation) => citation.url));
  const quality: EvidenceQuality = distinctPrimaryUrls.size > 1 ? 'verified_multiple_official' : 'verified_official';
  return { value, quality, citations, unresolvedReason: null, conflict: null };
}

/**
 * A value a primary source supports but which LandOS could not confirm applies
 * to the subject exactly — for example a district standard read from a code
 * whose district assignment for the parcel is still provisional.
 */
export function provisionalValue<T>(value: T, citations: LegalSourceCitation[], reason: string): EvidencedValue<T> {
  if (!citations.some((citation) => isPrimaryTier(citation.tier))) return unresolvedValue<T>(reason);
  return { value, quality: 'provisional_official', citations, unresolvedReason: reason, conflict: null };
}

/**
 * Enforcement, not decoration. Anything holding a value with no primary source
 * behind it is demoted to unverified rather than shown to an operator as law.
 */
export function assertEvidenceIntegrity<T>(value: EvidencedValue<T>): EvidencedValue<T> {
  if (value.value === null) return value;
  if (value.quality === 'unverified') return { ...value, value: null };
  if (!value.citations.some((citation) => isPrimaryTier(citation.tier))) {
    return {
      value: null,
      quality: 'unverified',
      citations: value.citations,
      unresolvedReason: value.unresolvedReason
        ?? 'No primary source supports this value, so it is not treated as established.',
      conflict: value.conflict,
    };
  }
  return value;
}

export function unresolvedAuthority(role: AuthorityRole, reason: string): ResolvedAuthority {
  return {
    role,
    name: unresolvedValue<string>(reason),
    unitType: 'unknown',
    relationship: null,
    officialUrl: null,
  };
}
