// Due Diligence business-status reconciliation.
//
// A green provider result is NOT a finished business question. Every category
// carries three separate axes the operator reads independently:
//
//   providerExecution   — did the machine step run?      (retrieved / failed /
//                         unavailable / not_run / blocked)
//   businessCompleteness — is the business question done? (complete / partial /
//                         insufficient / conflicted / blocked)
//   evidenceStrength    — how strong is what we have?     (official / screening /
//                         supporting / recorded_document / operator_verified /
//                         legal_grade)
//
// Pure + deterministic over the sanitized public-intelligence run.

import type {
  CountyRecordsFinding,
  FemaFloodFinding,
  FrontageFinding,
  PublicIntelligenceRun,
  PublicIntelligenceTaskRecord,
  SlopeFinding,
  SoilsSepticFinding,
  UtilitiesFinding,
  WetlandsFinding,
  ZoningLandUseFinding,
} from './public-property-intelligence.js';

export type ProviderExecution = 'retrieved' | 'failed' | 'unavailable' | 'not_run' | 'blocked';
export type BusinessCompleteness = 'complete' | 'partial' | 'insufficient' | 'conflicted' | 'blocked';
export type EvidenceStrength = 'official' | 'screening' | 'supporting' | 'recorded_document' | 'operator_verified' | 'legal_grade';

export interface DdCategoryStatus {
  key: string;
  label: string;
  providerExecution: ProviderExecution;
  businessCompleteness: BusinessCompleteness;
  evidenceStrength: EvidenceStrength | null;
  /** One-line honest read of where the business question stands. */
  note: string;
  /** What still has to happen before businessCompleteness can advance. */
  remaining: string[];
}

function execOf(task: PublicIntelligenceTaskRecord | undefined): ProviderExecution {
  if (!task) return 'not_run';
  if (task.status === 'succeeded' || task.status === 'partial') return 'retrieved';
  if (task.status === 'failed' || task.status === 'timed_out') return 'failed';
  if (task.status === 'unavailable') return 'unavailable';
  if (task.status === 'skipped_identity_gate' || task.status === 'blocked') return 'blocked';
  return 'not_run';
}

function taskOf(run: PublicIntelligenceRun | null | undefined, kind: string): PublicIntelligenceTaskRecord | undefined {
  return run?.tasks?.find((t) => t.task === kind);
}

function findingOf<T>(task: PublicIntelligenceTaskRecord | undefined, kind: string): T | null {
  return task?.finding && task.finding.kind === kind ? task.finding as unknown as T : null;
}

export interface DdBusinessStatusInput {
  run: PublicIntelligenceRun | null | undefined;
  acreageConflict: boolean;
  deedRetrieved: boolean;
}

export function buildDdBusinessStatus(input: DdBusinessStatusInput): DdCategoryStatus[] {
  const { run } = input;
  const rows: DdCategoryStatus[] = [];

  // ── Official county records ─────────────────────────────────────────────────
  {
    const task = taskOf(run, 'county_records');
    const county = findingOf<CountyRecordsFinding>(task, 'county_records');
    rows.push({
      key: 'county_records', label: 'Official county records',
      providerExecution: execOf(task),
      businessCompleteness: county ? (input.acreageConflict ? 'conflicted' : 'partial') : 'insufficient',
      evidenceStrength: county ? 'official' : null,
      note: county
        ? input.acreageConflict
          ? 'Official assessor/GIS facts retrieved, but assessed and mapped acreage conflict — legal acreage stays unresolved until a survey or recorded plat controls.'
          : 'Official assessor/GIS facts retrieved; recorded-instrument chain still open.'
        : 'No official county record retrieved yet.',
      remaining: county
        ? [...(input.acreageConflict ? ['Resolve legal acreage (survey or recorded plat)'] : []), ...(input.deedRetrieved ? [] : ['Read the recorded vesting deed']), 'Complete the title chain (prior deed, plat, later instruments)']
        : ['Retrieve the official county record'],
    });
  }

  // ── Wetlands ────────────────────────────────────────────────────────────────
  {
    const task = taskOf(run, 'wetlands');
    const wet = findingOf<WetlandsFinding>(task, 'wetlands');
    rows.push({
      key: 'wetlands', label: 'Wetlands',
      providerExecution: execOf(task),
      businessCompleteness: wet ? 'partial' : 'insufficient',
      evidenceStrength: wet ? 'screening' : null,
      note: wet
        ? `${wet.summary} Desktop screening only — a jurisdictional determination/delineation remains open.`
        : 'Wetland screening has not produced accepted evidence yet.',
      remaining: wet ? ['Field delineation / jurisdictional determination if pursuing'] : ['Run the wetland overlay screen'],
    });
  }

  // ── FEMA flood ──────────────────────────────────────────────────────────────
  {
    const task = taskOf(run, 'fema_flood');
    const flood = findingOf<FemaFloodFinding>(task, 'fema_flood');
    const remaining: string[] = [];
    if (flood) {
      if (!flood.panelNumber) remaining.push('FIRM panel number');
      if (!flood.effectiveDate) remaining.push('FIRM effective date');
      remaining.push('Floodway status', 'Local floodplain-administrator requirements', 'Access-route flood impact', 'Finished-floor elevation implications');
    } else {
      remaining.push('Run the flood overlay screen');
    }
    rows.push({
      key: 'fema_flood', label: 'FEMA flood',
      providerExecution: execOf(task),
      businessCompleteness: flood ? 'partial' : 'insufficient',
      evidenceStrength: flood ? 'screening' : null,
      note: flood
        ? 'Zone acreage/percentages are screened from the official flood layer, but the FIRM panel, effective date, floodway status, local requirements, and finished-floor implications are still open — the flood question is PARTIAL, not complete.'
        : 'Flood screening has not produced accepted evidence yet.',
      remaining,
    });
  }

  // ── Soils & septic ──────────────────────────────────────────────────────────
  {
    const task = taskOf(run, 'soils_septic');
    const soils = findingOf<SoilsSepticFinding>(task, 'soils_septic');
    rows.push({
      key: 'soils_septic', label: 'Soils & septic',
      providerExecution: execOf(task),
      businessCompleteness: soils ? 'partial' : 'insufficient',
      evidenceStrength: soils ? 'screening' : null,
      note: soils
        ? 'SSURGO absorption-field screening exists (all current interpretations rate the mapped units); septic feasibility is only resolved by a field perc/soil evaluation and a health-authority ruling.'
        : 'Soil screening has not produced accepted evidence yet.',
      remaining: soils ? ['Field perc/soil evaluation', 'Health-authority septic ruling'] : ['Run the SSURGO soils screen'],
    });
  }

  // ── Slope / terrain ─────────────────────────────────────────────────────────
  {
    const task = taskOf(run, 'slope_topography');
    const slope = findingOf<SlopeFinding>(task, 'slope_topography');
    rows.push({
      key: 'slope_topography', label: 'Slope & terrain',
      providerExecution: execOf(task),
      businessCompleteness: slope ? 'partial' : 'insufficient',
      evidenceStrength: slope ? 'screening' : null,
      note: slope
        ? 'Interior point samples characterize the terrain; parcel-wide slope-band acreage has NOT been calculated and is never derived from point samples.'
        : 'Terrain sampling has not produced accepted evidence yet.',
      remaining: slope ? ['Full-parcel DEM/topographic analysis (if the exit requires it)'] : ['Run the terrain point sample'],
    });
  }

  // ── Road proximity & access ─────────────────────────────────────────────────
  {
    const task = taskOf(run, 'road_frontage');
    const frontage = findingOf<FrontageFinding>(task, 'road_frontage');
    rows.push({
      key: 'road_access', label: 'Road proximity & access context',
      providerExecution: execOf(task),
      businessCompleteness: frontage ? 'insufficient' : 'insufficient',
      evidenceStrength: frontage ? 'screening' : null,
      note: frontage
        ? 'Centerline proximity is mapped, but the business question — does this parcel have physical and legal access? — is unresolved. Parcel–road contact, right-of-way contact, frontage, driveway access, legal access, and road maintenance are all open.'
        : 'Road-proximity screening has not produced accepted evidence yet.',
      remaining: [
        'Parcel–road boundary contact determination',
        'Public right-of-way contact determination',
        'Recorded access instrument (easement/dedication) review',
        'Physical/driveway access confirmation',
        'Road maintenance responsibility',
      ],
    });
  }

  // ── Zoning & land use ───────────────────────────────────────────────────────
  {
    const task = taskOf(run, 'zoning_landuse');
    const zoning = findingOf<ZoningLandUseFinding>(task, 'zoning_landuse');
    const ordinanceItems = ['Minimum lot size', 'Minimum frontage', 'Setbacks', 'Density', 'Permitted residential uses', 'Manufactured-home rules', 'Subdivision rules', 'Overlay requirements', 'Flood-zoning interaction', 'Conforming status'];
    rows.push({
      key: 'zoning_landuse', label: 'Zoning & land use',
      providerExecution: execOf(task),
      businessCompleteness: zoning?.zoningCode ? 'partial' : 'insufficient',
      evidenceStrength: zoning?.zoningCode ? 'official' : null,
      note: zoning?.zoningCode
        ? `Official district (${zoning.zoningCode}${zoning.overlayDistricts.length ? ` + ${zoning.overlayDistricts.join(', ')}` : ''}) and future land use are retrieved, but the ordinance analysis is PARTIAL until the ordinance text answers the development rules.`
        : 'Zoning district has not been retrieved yet.',
      remaining: zoning?.zoningCode ? (zoning.minimumLotSize ? ordinanceItems.slice(1) : ordinanceItems) : ['Retrieve the official zoning district'],
    });
  }

  // ── Utilities ───────────────────────────────────────────────────────────────
  {
    const task = taskOf(run, 'utilities');
    const utilities = findingOf<UtilitiesFinding>(task, 'utilities');
    rows.push({
      key: 'utilities', label: 'Utilities',
      providerExecution: execOf(task),
      businessCompleteness: utilities ? 'partial' : 'insufficient',
      evidenceStrength: utilities ? 'screening' : null,
      note: utilities
        ? 'Evidence: no county GIS public water/sewer line is identified at the mapped parcel. Inference (not evidence): private well and onsite septic may be required. Service availability is only resolved by the utility authority and the health authority — never implied from visible power lines.'
        : 'Utility line screening has not produced accepted evidence yet.',
      remaining: utilities
        ? ['Utility-authority service confirmation (water/sewer)', 'Health-authority septic path confirmation', 'Electric service confirmation']
        : ['Run the utility line screen'],
    });
  }

  return rows;
}

export const DD_STATUS_LABELS = {
  providerExecution: {
    retrieved: 'Retrieved', failed: 'Failed', unavailable: 'Unavailable', not_run: 'Not run', blocked: 'Blocked',
  },
  businessCompleteness: {
    complete: 'Complete', partial: 'Partial', insufficient: 'Insufficient', conflicted: 'Conflicted', blocked: 'Blocked',
  },
} as const;
