// Canonical acreage & spatial basis (shared, system-wide).
//
// Root cause this module fixes: the Deal Card carried only a flat
// `assessedAcres` / `mappedAcres` pair plus a boolean `acreageConflict`. That
// let the card silently pick one number for the header, another for overlays,
// and a third for valuation, and never raised an explicit operator decision
// when the official assessed size and the mapped GIS geometry disagreed.
//
// This record distinguishes EVERY acreage basis a land deal can carry, attaches
// provenance + permitted-use metadata to each, decides which basis each
// downstream consumer (display, spatial overlay, valuation, strategy math) is
// allowed to read, and surfaces a discrete "Tyler decision required" item plus
// consistency issues when the bases materially disagree or when a spatial
// overlay reports more area than the geometry it was actually computed against.
//
// Pure + deterministic. No I/O, no provider calls. Loose inputs so it is unit
// testable in isolation. Every current and future Deal Card consumes it through
// the shared operator property record.

export type AcreageBasisKind =
  | 'assessed'          // official county assessor roll acreage
  | 'deeded'            // acreage recited in the recorded deed
  | 'surveyed'          // a recorded/registered survey or plat
  | 'gis_geometry'      // acreage of the county GIS parcel polygon actually queried
  | 'provider'          // a data provider's derived acreage (LandPortal/Realie/etc.)
  | 'operator_accepted' // the value Tyler has explicitly accepted as governing
  | 'valuation'         // the basis the valuation math is disclosed to use
  | 'spatial_overlay';  // the geometry area overlays (flood/wetlands/soils/slope) were sampled against

/** Provenance strength — higher wins when selecting a governing basis. */
export type AcreageConfidence = 'operator' | 'official' | 'recorded' | 'provider' | 'derived' | 'unknown';

const CONFIDENCE_RANK: Record<AcreageConfidence, number> = {
  operator: 6,
  official: 5,
  recorded: 5,
  provider: 3,
  derived: 2,
  unknown: 0,
};

/** What a given basis is allowed to drive. Enforced by consumers, not implied. */
export type AcreageUse = 'display' | 'overlay' | 'valuation' | 'strategy_math';

export interface AcreageBasisEntry {
  kind: AcreageBasisKind;
  value: number | null;
  /** Operator-facing provenance ("County assessor roll", "County GIS geometry", …). */
  source: string | null;
  confidence: AcreageConfidence;
  /** True when this value materially disagrees with another trusted basis. */
  disputed: boolean;
  /** True only when Tyler has explicitly accepted this value as governing. */
  operatorAccepted: boolean;
  /** The uses this basis is permitted to drive (never inferred by the consumer). */
  permittedUses: AcreageUse[];
  /** Plain limitation an operator must keep in mind ("tax roll lags survey", …). */
  limitation: string;
}

export interface AcreageConsistencyIssue {
  code:
    | 'material_discrepancy'      // two trusted bases disagree beyond tolerance
    | 'overlay_exceeds_geometry'  // an overlay reported more area than its queried geometry
    | 'unresolved_basis_used'     // a gated calc used a basis the header treats as unresolved
    | 'accepted_overwritten';     // an accepted value was changed without confirmation
  severity: 'blocker' | 'major' | 'minor';
  message: string;
}

export interface AcreageReconciliation {
  entries: AcreageBasisEntry[];
  /** Basis the header/description should display. */
  displayBasis: AcreageBasisKind | null;
  /** Basis spatial overlays (flood/wetlands/soils/slope) must be computed against. */
  overlayBasis: AcreageBasisKind | null;
  /** Basis the valuation math is permitted to use, disclosed to the operator. */
  valuationBasis: AcreageBasisKind | null;
  /** Any two trusted bases disagree materially. */
  disputed: boolean;
  /** A material discrepancy with no operator-accepted resolution → Tyler must decide. */
  tylerDecisionRequired: boolean;
  /** The decision text surfaced under "Tyler decision required" (null when none). */
  decision: string | null;
  /** Human explanation of why assessed and mapped acreage differ (empty when they don't). */
  explanation: string;
  issues: AcreageConsistencyIssue[];
}

export interface AcreageSignal {
  value: number | null | undefined;
  source?: string | null;
}

export interface AcreageBasisInput {
  assessed?: AcreageSignal | null;
  deeded?: AcreageSignal | null;
  surveyed?: AcreageSignal | null;
  gisGeometry?: AcreageSignal | null;
  provider?: AcreageSignal | null;
  /** The value Tyler has explicitly accepted, if any. */
  operatorAccepted?: AcreageSignal | null;
  /**
   * Relative tolerance above which two bases are a MATERIAL discrepancy.
   * Default 5% — assessor rolls and GIS polygons routinely differ by a few
   * percent; a difference beyond this needs a survey/plat to resolve.
   */
  materialRelTolerance?: number;
  /** Absolute acreage floor for materiality (default 0.1 ac). */
  materialAbsTolerance?: number;
}

const DEFAULT_REL_TOL = 0.05;
const DEFAULT_ABS_TOL = 0.1;

function num(sig: AcreageSignal | null | undefined): number | null {
  const v = sig?.value;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const CONFIDENCE_OF: Record<Exclude<AcreageBasisKind, 'valuation' | 'spatial_overlay'>, AcreageConfidence> = {
  assessed: 'official',
  deeded: 'recorded',
  surveyed: 'recorded',
  gis_geometry: 'official',
  provider: 'provider',
  operator_accepted: 'operator',
};

const DEFAULT_LIMITATION: Record<AcreageBasisKind, string> = {
  assessed: 'Assessor roll acreage — lags surveys and can predate boundary corrections.',
  deeded: 'Deeded acreage — reflects the recorded conveyance, not necessarily a measured survey.',
  surveyed: 'Survey/plat acreage — strongest legal size when recorded and current.',
  gis_geometry: 'County GIS polygon area — mapping generalization; not a legal survey.',
  provider: 'Provider-derived acreage — secondary to the official county record.',
  operator_accepted: 'Operator-accepted governing acreage.',
  valuation: 'Basis disclosed for the valuation math.',
  spatial_overlay: 'Geometry area the spatial overlays were sampled against.',
};

/** Two positive numbers differ materially past either the relative or absolute floor. */
export function materiallyDifferentAcres(
  a: number,
  b: number,
  relTol = DEFAULT_REL_TOL,
  absTol = DEFAULT_ABS_TOL,
): boolean {
  const diff = Math.abs(a - b);
  const rel = diff / Math.max(a, b, 1e-9);
  return diff > absTol && rel > relTol;
}

/**
 * A spatial overlay (flood zone, wetland, soil unit, slope class) can never
 * cover more area than the parcel geometry it was sampled against. When it does,
 * and no documented explanation is supplied, that is a data-integrity failure
 * (usually an overlay computed against a different/larger acreage than the
 * geometry shown). Returns an issue, or null when consistent.
 */
export function checkOverlayConsistency(input: {
  overlayLabel: string;
  overlayAcres: number | null | undefined;
  geometryAcres: number | null | undefined;
  /** A documented reason the overlay legitimately exceeds geometry (rare). */
  documentedExplanation?: string | null;
  /** Rounding slack for sampling error (default 0.02 ac). */
  toleranceAcres?: number;
}): AcreageConsistencyIssue | null {
  const overlay = typeof input.overlayAcres === 'number' && Number.isFinite(input.overlayAcres) ? input.overlayAcres : null;
  const geom = typeof input.geometryAcres === 'number' && Number.isFinite(input.geometryAcres) ? input.geometryAcres : null;
  if (overlay == null || geom == null || geom <= 0) return null;
  const slack = input.toleranceAcres ?? 0.02;
  if (overlay <= geom + slack) return null;
  if (input.documentedExplanation && input.documentedExplanation.trim()) return null;
  return {
    code: 'overlay_exceeds_geometry',
    severity: 'major',
    message: `${input.overlayLabel} overlay reports ${round2(overlay)} ac but the queried parcel geometry is only ${round2(geom)} ac. An overlay cannot exceed the geometry it was sampled against without a documented explanation — recompute the overlay against the mapped geometry.`,
  };
}

/**
 * Pin overlay zones (flood/wetlands/soil bands) to the queried GIS geometry: a
 * zone's acreage is the mapped-geometry area times its parcel percentage, never a
 * provider/assessed acreage. Used by every consumer that renders an overlay area
 * (operator record, reconciliation facts, govDd) so an overlay can never report
 * more acres than the mapped parcel and the three surfaces can never diverge.
 */
export function pinOverlayAcresToGeometry<T extends { parcelPercentage: number; approximateAcres: number }>(
  zones: T[],
  mappedAcres: number | null | undefined,
): T[] {
  if (mappedAcres == null || !Number.isFinite(mappedAcres) || mappedAcres <= 0) return zones;
  return zones.map((z) => ({
    ...z,
    approximateAcres: z.parcelPercentage != null
      ? Math.round((mappedAcres * z.parcelPercentage / 100) * 1000) / 1000
      : z.approximateAcres,
  }));
}

/** Build the shared acreage-basis reconciliation from the available signals. */
export function buildAcreageBasis(input: AcreageBasisInput): AcreageReconciliation {
  const relTol = input.materialRelTolerance ?? DEFAULT_REL_TOL;
  const absTol = input.materialAbsTolerance ?? DEFAULT_ABS_TOL;

  const raw: Array<{ kind: Exclude<AcreageBasisKind, 'valuation' | 'spatial_overlay'>; value: number | null; source: string | null }> = [
    { kind: 'operator_accepted', value: num(input.operatorAccepted), source: input.operatorAccepted?.source ?? 'Operator accepted' },
    { kind: 'surveyed', value: num(input.surveyed), source: input.surveyed?.source ?? 'Recorded survey/plat' },
    { kind: 'deeded', value: num(input.deeded), source: input.deeded?.source ?? 'Recorded deed' },
    { kind: 'assessed', value: num(input.assessed), source: input.assessed?.source ?? 'County assessor roll' },
    { kind: 'gis_geometry', value: num(input.gisGeometry), source: input.gisGeometry?.source ?? 'County GIS geometry' },
    { kind: 'provider', value: num(input.provider), source: input.provider?.source ?? 'Data provider' },
  ];
  const present = raw.filter((r) => r.value != null);

  // Trusted bases for dispute detection: official / recorded / operator (never provider-only).
  const trusted = present.filter((r) => CONFIDENCE_RANK[CONFIDENCE_OF[r.kind]] >= CONFIDENCE_RANK.provider + 1);

  // Material dispute: any two trusted bases disagree past tolerance.
  let disputed = false;
  const disputePairs: string[] = [];
  for (let i = 0; i < trusted.length; i += 1) {
    for (let j = i + 1; j < trusted.length; j += 1) {
      const a = trusted[i];
      const b = trusted[j];
      if (a.value != null && b.value != null && materiallyDifferentAcres(a.value, b.value, relTol, absTol)) {
        disputed = true;
        disputePairs.push(`${a.source} ${a.value} ac vs ${b.source} ${b.value} ac`);
      }
    }
  }

  const acceptedEntry = present.find((r) => r.kind === 'operator_accepted') ?? null;
  const operatorAccepted = acceptedEntry != null;

  // Governing basis for a use = highest-confidence present basis permitted for it.
  // Overlays are ALWAYS bound to the GIS geometry that was actually queried, never
  // to the assessed number, so overlay percentages/areas reconcile with the map.
  const byConfidence = [...present].sort(
    (a, b) => CONFIDENCE_RANK[CONFIDENCE_OF[b.kind]] - CONFIDENCE_RANK[CONFIDENCE_OF[a.kind]],
  );
  const gis = present.find((r) => r.kind === 'gis_geometry') ?? null;
  const overlayBasis: AcreageBasisKind | null = gis ? 'gis_geometry' : (byConfidence[0]?.kind ?? null);
  const displayBasis: AcreageBasisKind | null = operatorAccepted ? 'operator_accepted' : (byConfidence[0]?.kind ?? null);

  // Valuation basis: the operator-accepted value governs; otherwise the highest
  // confidence basis, BUT when the size is disputed and unaccepted the valuation
  // basis is only permitted for display context, never as a gated offer number,
  // until Tyler resolves the discrepancy.
  const valuationBasis: AcreageBasisKind | null = operatorAccepted ? 'operator_accepted' : (byConfidence[0]?.kind ?? null);

  const tylerDecisionRequired = disputed && !operatorAccepted;

  const assessed = present.find((r) => r.kind === 'assessed');
  const gisEntry = present.find((r) => r.kind === 'gis_geometry');
  let explanation = '';
  if (assessed?.value != null && gisEntry?.value != null && materiallyDifferentAcres(assessed.value, gisEntry.value, relTol, absTol)) {
    const bigger = assessed.value > gisEntry.value ? 'assessed' : 'mapped';
    explanation =
      `Assessed acreage (${assessed.value} ac, ${assessed.source}) and mapped GIS geometry (${gisEntry.value} ac, ${gisEntry.source}) disagree. ` +
      `Assessor rolls and GIS polygons are produced separately: the ${bigger} figure is larger, commonly from tax-roll lag, boundary generalization in the GIS layer, or an uncorrected split. ` +
      `A recorded survey or plat controls the true size; neither number is authoritative on its own.`;
  }

  const issues: AcreageConsistencyIssue[] = [];
  if (tylerDecisionRequired) {
    issues.push({
      code: 'material_discrepancy',
      severity: 'major',
      message: `Acreage bases disagree materially (${disputePairs.join('; ')}) and none is operator-accepted. Do not price on a disputed size — confirm against a survey/plat.`,
    });
  }

  const permittedUsesFor = (kind: AcreageBasisEntry['kind']): AcreageUse[] => {
    switch (kind) {
      case 'operator_accepted':
        return ['display', 'overlay', 'valuation', 'strategy_math'];
      case 'surveyed':
        return ['display', 'valuation', 'strategy_math'];
      case 'deeded':
        return ['display', 'valuation'];
      case 'assessed':
        // A disputed, unaccepted assessed value may inform display but not a gated calc.
        return disputed && !operatorAccepted ? ['display'] : ['display', 'valuation'];
      case 'gis_geometry':
        return ['display', 'overlay'];
      case 'provider':
        return ['display'];
      default:
        return ['display'];
    }
  };

  const entries: AcreageBasisEntry[] = present.map((r) => ({
    kind: r.kind,
    value: r.value,
    source: r.source,
    confidence: CONFIDENCE_OF[r.kind],
    disputed: disputed && trusted.some((t) => t.kind === r.kind),
    operatorAccepted: r.kind === 'operator_accepted',
    permittedUses: permittedUsesFor(r.kind),
    limitation: DEFAULT_LIMITATION[r.kind],
  }));

  // Synthetic entries recording which basis each downstream use resolves to, so
  // the audit and UI can show "valuation uses <basis>" and "overlays use <basis>".
  if (valuationBasis) {
    const src = present.find((r) => r.kind === valuationBasis);
    entries.push({
      kind: 'valuation',
      value: src?.value ?? null,
      source: src?.source ?? null,
      confidence: src ? CONFIDENCE_OF[src.kind] : 'unknown',
      disputed,
      operatorAccepted,
      permittedUses: disputed && !operatorAccepted ? ['display'] : ['valuation'],
      limitation: disputed && !operatorAccepted
        ? `Valuation size is disputed and not operator-accepted — shown for context only; not a defensible offer basis until Tyler resolves the acreage.`
        : `Valuation uses the ${valuationBasis.replace(/_/g, ' ')} basis.`,
    });
  }
  if (overlayBasis) {
    const src = present.find((r) => r.kind === overlayBasis);
    entries.push({
      kind: 'spatial_overlay',
      value: src?.value ?? null,
      source: src?.source ?? null,
      confidence: src ? CONFIDENCE_OF[src.kind] : 'unknown',
      disputed: false,
      operatorAccepted: false,
      permittedUses: ['overlay'],
      limitation: `Overlays (flood/wetlands/soils/slope) are sampled against the ${overlayBasis.replace(/_/g, ' ')} area.`,
    });
  }

  const decision = tylerDecisionRequired
    ? `Acreage basis unresolved: ${disputePairs.join('; ')}. Confirm the governing size (order/attach a survey or recorded plat) before pricing an offer or presenting a defensible valuation.`
    : null;

  return {
    entries,
    displayBasis,
    overlayBasis,
    valuationBasis,
    disputed,
    tylerDecisionRequired,
    decision,
    explanation,
    issues,
  };
}

/**
 * Guard for the operator-confirmation rule: an accepted acreage may not be
 * silently replaced. Returns an issue when a new governing value differs from a
 * previously accepted value without a fresh acceptance.
 */
export function detectAcceptedOverwrite(input: {
  previouslyAccepted: number | null | undefined;
  newGoverning: number | null | undefined;
  reaccepted: boolean;
}): AcreageConsistencyIssue | null {
  const prev = typeof input.previouslyAccepted === 'number' && Number.isFinite(input.previouslyAccepted) ? input.previouslyAccepted : null;
  const next = typeof input.newGoverning === 'number' && Number.isFinite(input.newGoverning) ? input.newGoverning : null;
  if (prev == null || next == null) return null;
  if (!materiallyDifferentAcres(prev, next)) return null;
  if (input.reaccepted) return null;
  return {
    code: 'accepted_overwritten',
    severity: 'blocker',
    message: `A previously accepted acreage (${prev} ac) would be replaced by ${next} ac without Tyler's re-confirmation. Preserve both and surface a Tyler decision — never silently overwrite an accepted value.`,
  };
}
