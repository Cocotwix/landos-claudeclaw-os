// LandOS — official acreage & parcel-extent reconciliation (pure engine).
//
// Root cause this module fixes: a property carried several conflicting acreage
// figures (current official assessment, county GIS attributes, historical
// planning documents, a data provider) with no shared rule for which figure
// describes the CURRENT tax parcel, which described a prior parcel extent, and
// which is simply a different measurement of the same land. The Deal Card then
// presented one of them as though it were settled.
//
// This engine takes every retained acreage evidence record — each carrying its
// own source class and value type — plus the current official record, an
// optional county-GIS depiction, and any sibling parcels found in the current
// assessment database, and produces ONE deterministic reconciliation:
//
//   • official reported acreage, GIS calculated area, historical project
//     acreage and provider acreage remain DISTINCT concepts; never merged,
//     never averaged;
//   • the current official record's acreage becomes canonical ONLY when its
//     official parcel identifier matches the canonical APN exactly;
//   • historical/provider figures are explained (e.g. a pre-split parent
//     extent) when the arithmetic of the current parcel plus split-off
//     siblings supports it — otherwise the discrepancy stays explicit;
//   • every input value is retained with provenance; changing the canonical
//     figure marks acreage-dependent derived products stale rather than
//     silently rerunning or silently keeping them.
//
// Pure + deterministic. No I/O. The bounded evidence gathering lives in
// official-acreage-run.ts; this module only decides.

export type AcreageValueType =
  | 'official_reported'   // acreage field carried by the current assessor/property record
  | 'gis_calculated'      // area mathematically derived from the mapped parcel polygon
  | 'gis_reported'        // acreage ATTRIBUTE carried on the GIS parcel layer (not computed)
  | 'historical_project'  // acreage stated in older planning/development documents
  | 'provider_reported'   // marketplace/data-provider acreage field
  | 'provider_calculated'; // area the provider derived from its own mapped geometry

export type AcreageSourceClass =
  | 'official_record'
  | 'gis_observation'
  | 'historical_record'
  | 'provider_claim';

export interface AcreageEvidenceRecord {
  valueAcres: number;
  valueType: AcreageValueType;
  sourceClass: AcreageSourceClass;
  source: string;
  sourceUrl: string | null;
  retrievedAt: string | null;
  /** ISO date the value is understood to be effective for, when known. */
  effectiveAt: string | null;
  /**
   * TRUE only when the record's own parcel identifier was verified to name the
   * canonical subject APN exactly (segment for segment). NULL when the source
   * carries no parcel identifier to verify.
   */
  identityMatchesSubject: boolean | null;
  /** Vintage relative to the current official record. */
  vintage: 'current' | 'stale' | 'historical' | 'unknown';
  note: string;
}

export interface SiblingParcelRecord {
  officialParcelId: string;
  owner: string | null;
  legalAcres: number | null;
  lastTransferDate: string | null;
  deedBookPage: string | null;
  situsAddress: string | null;
}

export interface GisDepictionRecord {
  /** Acreage ATTRIBUTE the GIS layer carries for the subject parcel. */
  reportedAcres: number | null;
  /** Polygon-calculated area the GIS layer carries, when exposed. */
  calculatedAcres: number | null;
  owner: string | null;
  gisParcelId: string | null;
  source: string;
  sourceUrl: string | null;
  retrievedAt: string | null;
  /** Number of polygon features the subject maps to (1 = one piece). */
  featureCount: number | null;
}

export interface AcreageExtentInput {
  subjectApn: string;
  /** The current official record read (assessor). Required for any adoption. */
  official: {
    acres: number | null;
    owner: string | null;
    officialParcelId: string | null;
    /** Verified segment-for-segment match against subjectApn (caller-computed). */
    identityMatchesSubject: boolean;
    source: string;
    sourceUrl: string | null;
    retrievedAt: string | null;
    lastTransferDate: string | null;
    deedBookPage: string | null;
  } | null;
  gis: GisDepictionRecord | null;
  siblings: readonly SiblingParcelRecord[];
  provider: { acres: number | null; source: string; sourceUrl: string | null; retrievedAt: string | null } | null;
  /** Area the provider derived from its own mapped geometry, when retained. */
  providerCalculated?: { acres: number; source: string; note: string } | null;
  historical: readonly { acres: number; source: string; note: string }[];
  /** The acreage the Deal Card currently carries as canonical. */
  priorCanonicalAcres: number | null;
  /** Absolute tolerance for split/extent arithmetic (default 0.15 ac). */
  extentToleranceAcres?: number;
}

export type AcreageExtentStatus =
  | 'resolved_current_canonical'
  | 'resolved_current_vs_historical_extent'
  | 'partially_resolved'
  | 'unresolved';

export interface AcreageReasoningLine {
  classification:
    | 'FACT' | 'OFFICIAL RECORD' | 'GIS OBSERVATION' | 'HISTORICAL RECORD'
    | 'PROVIDER CLAIM' | 'CONFLICT' | 'INTERPRETATION' | 'CURRENT CONCLUSION';
  statement: string;
}

export interface AcreageExtentDecision {
  status: AcreageExtentStatus;
  /** Canonical CURRENT parcel acreage, only when resolved. Never an average. */
  canonicalAcres: number | null;
  canonicalValueType: AcreageValueType | null;
  canonicalSource: string | null;
  canonicalSourceUrl: string | null;
  canonicalRetrievedAt: string | null;
  confidence: 'confirmed' | 'well_supported' | 'likely' | 'unresolved';
  /** One-parcel vs multiple-pieces extent statement, only when supported. */
  parcelExtent: string | null;
  /** The split/assemblage explanation, only when the arithmetic supports it. */
  extentExplanation: string | null;
  /** Sibling parcels the explanation rests on. */
  extentSiblings: SiblingParcelRecord[];
  /** Every acreage value retained with provenance — nothing deleted. */
  retained: AcreageEvidenceRecord[];
  reasoning: AcreageReasoningLine[];
  /** True when the canonical figure changed against priorCanonicalAcres. */
  canonicalChanged: boolean;
  /** Derived products that must be marked stale (never auto-rerun). */
  staleProducts: string[];
  unresolvedQuestions: string[];
}

/** Products whose math consumed the canonical acreage. Marked stale on change. */
export const ACREAGE_DEPENDENT_PRODUCTS = [
  'valuation',
  'comps_acreage_band',
  'market_acreage_band',
  'per_acre_pricing',
  'buildable_metrics',
  'subdivision_screening',
  'strategy_economics',
  'deal_brain_guidance',
] as const;

const round2 = (n: number): number => Math.round(n * 100) / 100;
const normName = (v: string | null | undefined): string => String(v ?? '').replace(/[^a-z0-9]/gi, '').toUpperCase();
const isAcres = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/**
 * PURE: can the parent figure be explained as the current parcel plus one or
 * two split-off siblings? Returns the sibling set that closes the arithmetic
 * within tolerance, or null. Deterministic: singles first (by official id),
 * then pairs; first exact-enough combination wins.
 */
export function explainParentExtent(
  parentAcres: number,
  currentAcres: number,
  siblings: readonly SiblingParcelRecord[],
  toleranceAcres: number,
): SiblingParcelRecord[] | null {
  const usable = siblings
    .filter((s) => isAcres(s.legalAcres))
    .sort((a, b) => a.officialParcelId.localeCompare(b.officialParcelId));
  const closes = (sum: number): boolean => Math.abs(parentAcres - (currentAcres + sum)) <= toleranceAcres;
  if (closes(0)) return [];
  for (const s of usable) if (closes(s.legalAcres!)) return [s];
  for (let i = 0; i < usable.length; i += 1) {
    for (let j = i + 1; j < usable.length; j += 1) {
      if (closes(usable[i].legalAcres! + usable[j].legalAcres!)) return [usable[i], usable[j]];
    }
  }
  return null;
}

/** Build the retained evidence set — every source value, separately provenanced. */
function retainedEvidence(input: AcreageExtentInput, gisStale: boolean): AcreageEvidenceRecord[] {
  const out: AcreageEvidenceRecord[] = [];
  const o = input.official;
  if (o && isAcres(o.acres)) {
    out.push({
      valueAcres: o.acres,
      valueType: 'official_reported',
      sourceClass: 'official_record',
      source: o.source,
      sourceUrl: o.sourceUrl,
      retrievedAt: o.retrievedAt,
      effectiveAt: o.retrievedAt,
      identityMatchesSubject: o.identityMatchesSubject,
      vintage: 'current',
      note: 'Legal acreage carried by the current official assessment record.',
    });
  }
  const g = input.gis;
  if (g && isAcres(g.reportedAcres)) {
    out.push({
      valueAcres: g.reportedAcres,
      valueType: 'gis_reported',
      sourceClass: 'gis_observation',
      source: g.source,
      sourceUrl: g.sourceUrl,
      retrievedAt: g.retrievedAt,
      effectiveAt: null,
      identityMatchesSubject: g.gisParcelId != null ? true : null,
      vintage: gisStale ? 'stale' : 'unknown',
      note: gisStale
        ? 'Acreage attribute on the county GIS parcel layer; the layer\'s record vintage predates the current official record.'
        : 'Acreage attribute on the county GIS parcel layer.',
    });
  }
  if (g && isAcres(g.calculatedAcres)) {
    out.push({
      valueAcres: g.calculatedAcres,
      valueType: 'gis_calculated',
      sourceClass: 'gis_observation',
      source: g.source,
      sourceUrl: g.sourceUrl,
      retrievedAt: g.retrievedAt,
      effectiveAt: null,
      identityMatchesSubject: g.gisParcelId != null ? true : null,
      vintage: gisStale ? 'stale' : 'unknown',
      note: 'Area mathematically derived from the mapped parcel polygon; mapping generalization, not a legal survey.',
    });
  }
  for (const h of input.historical) {
    if (!isAcres(h.acres)) continue;
    out.push({
      valueAcres: h.acres,
      valueType: 'historical_project',
      sourceClass: 'historical_record',
      source: h.source,
      sourceUrl: null,
      retrievedAt: null,
      effectiveAt: null,
      identityMatchesSubject: null,
      vintage: 'historical',
      note: h.note,
    });
  }
  const p = input.provider;
  if (p && isAcres(p.acres)) {
    out.push({
      valueAcres: p.acres,
      valueType: 'provider_reported',
      sourceClass: 'provider_claim',
      source: p.source,
      sourceUrl: p.sourceUrl,
      retrievedAt: p.retrievedAt,
      effectiveAt: null,
      identityMatchesSubject: null,
      vintage: 'unknown',
      note: 'Provider-reported acreage; secondary to the official county record.',
    });
  }
  const pc = input.providerCalculated;
  if (pc && isAcres(pc.acres)) {
    out.push({
      valueAcres: pc.acres,
      valueType: 'provider_calculated',
      sourceClass: 'provider_claim',
      source: pc.source,
      sourceUrl: null,
      retrievedAt: null,
      effectiveAt: null,
      identityMatchesSubject: null,
      vintage: 'unknown',
      note: pc.note,
    });
  }
  return out;
}

/**
 * Decide the canonical CURRENT acreage and parcel extent from the gathered
 * evidence. Never averages; never lets a historical or provider figure become
 * the current parcel acreage; never adopts an official figure whose parcel
 * identity was not verified against the canonical APN.
 */
export function reconcileAcreageExtent(input: AcreageExtentInput): AcreageExtentDecision {
  const tol = input.extentToleranceAcres ?? 0.15;
  const reasoning: AcreageReasoningLine[] = [];
  const unresolved: string[] = [];

  const official = input.official;
  const officialUsable = !!official && isAcres(official.acres) && official.identityMatchesSubject;

  // GIS vintage: the layer is STALE relative to the official record when its
  // owner disagrees with the current owner of record.
  const gisStale = !!(
    input.gis?.owner
    && official?.owner
    && normName(input.gis.owner) !== normName(official.owner)
  );

  const retained = retainedEvidence(input, gisStale);

  if (official && isAcres(official.acres)) {
    reasoning.push({
      classification: 'OFFICIAL RECORD',
      statement: `${official.source} carries ${official.acres} ac legal acreage for parcel "${official.officialParcelId ?? 'unknown'}"`
        + (official.owner ? `, owner of record ${official.owner}` : '')
        + (official.lastTransferDate ? `, last recorded transfer ${official.lastTransferDate}${official.deedBookPage ? ` (deed ${official.deedBookPage})` : ''}` : '')
        + '.',
    });
    if (!official.identityMatchesSubject) {
      reasoning.push({
        classification: 'CONFLICT',
        statement: `The official record's parcel identifier "${official.officialParcelId ?? ''}" does not match the canonical APN ${input.subjectApn} segment for segment, so its acreage cannot be adopted.`,
      });
      unresolved.push('The current official record does not verifiably name the canonical parcel, so no official acreage can be adopted.');
    }
  } else {
    unresolved.push('No current official assessment record with a usable acreage is in evidence.');
  }

  if (input.gis) {
    const g = input.gis;
    const parts: string[] = [];
    if (isAcres(g.reportedAcres)) parts.push(`acreage attribute ${g.reportedAcres} ac`);
    if (isAcres(g.calculatedAcres)) parts.push(`polygon-calculated area ${g.calculatedAcres} ac`);
    if (g.featureCount != null) parts.push(`${g.featureCount} polygon${g.featureCount === 1 ? '' : 's'}`);
    if (g.owner) parts.push(`owner attribute "${g.owner}"`);
    if (parts.length) {
      reasoning.push({
        classification: 'GIS OBSERVATION',
        statement: `${g.source} depicts parcel ${g.gisParcelId ?? input.subjectApn} with ${parts.join(', ')}.`
          + (gisStale ? ` The layer's owner attribute disagrees with the current owner of record, so this depiction predates the current official record.` : ''),
      });
    }
  }

  for (const h of input.historical) {
    if (isAcres(h.acres)) reasoning.push({ classification: 'HISTORICAL RECORD', statement: `${h.source}: ${h.acres} ac. ${h.note}` });
  }
  if (input.provider && isAcres(input.provider.acres)) {
    reasoning.push({ classification: 'PROVIDER CLAIM', statement: `${input.provider.source} reports ${input.provider.acres} ac.` });
  }
  if (input.providerCalculated && isAcres(input.providerCalculated.acres)) {
    reasoning.push({ classification: 'PROVIDER CLAIM', statement: `${input.providerCalculated.source}: ${input.providerCalculated.acres} ac. ${input.providerCalculated.note}` });
  }

  // ---- Canonical selection: ONLY the identity-verified current official record.
  let canonicalAcres: number | null = null;
  let confidence: AcreageExtentDecision['confidence'] = 'unresolved';
  if (officialUsable) {
    canonicalAcres = official!.acres!;
    confidence = 'confirmed';
    reasoning.push({
      classification: 'FACT',
      statement: `The canonical APN ${input.subjectApn} matched exactly one current official record; its ${canonicalAcres} ac legal acreage outranks provider and historical figures for the CURRENT tax parcel.`,
    });
  }

  // ---- Explain the larger historical/provider figures, if the evidence can.
  // Candidate "parent extent" figures: any retained non-current value that
  // materially exceeds the canonical figure.
  let extentExplanation: string | null = null;
  let extentSiblings: SiblingParcelRecord[] = [];
  let extentResolved = false;
  const largerFigures = retained.filter((r) =>
    r.valueType !== 'official_reported'
    && canonicalAcres != null
    && r.valueAcres > canonicalAcres + tol);

  if (canonicalAcres != null && largerFigures.length) {
    // Try the split arithmetic against the largest precisely-stated figure
    // (gis_reported/provider values are exact record figures; historical
    // planning figures are approximate).
    const exactParents = largerFigures.filter((r) => r.valueType === 'gis_reported' || r.valueType === 'provider_reported');
    const parent = (exactParents.length ? exactParents : largerFigures)
      .slice()
      .sort((a, b) => b.valueAcres - a.valueAcres)[0];
    const closing = explainParentExtent(parent.valueAcres, canonicalAcres, input.siblings, tol);
    if (closing && closing.length) {
      extentSiblings = closing;
      const sumParts = closing.map((s) => `${s.legalAcres} ac (parcel ${s.officialParcelId}${s.owner ? `, ${s.owner}` : ''}${s.lastTransferDate ? `, transferred ${s.lastTransferDate}` : ''}${s.deedBookPage ? `, deed ${s.deedBookPage}` : ''})`);
      extentExplanation =
        `The ${parent.valueAcres} ac figure (${parent.source}) describes the PRIOR extent of this tract. `
        + `The current parcel carries ${canonicalAcres} ac, and ${sumParts.join(' plus ')} `
        + `${closing.length === 1 ? 'was' : 'were'} split off: ${round2(canonicalAcres)} + ${closing.map((s) => round2(s.legalAcres!)).join(' + ')} = ${round2(canonicalAcres + closing.reduce((a, s) => a + s.legalAcres!, 0))} ac, `
        + `matching the prior extent within ${tol} ac. Historical and provider figures describe the pre-split tract, not the current tax parcel.`;
      extentResolved = true;
      reasoning.push({ classification: 'INTERPRETATION', statement: extentExplanation });
    } else if (closing && closing.length === 0) {
      // Parent equals current within tolerance — no real extent conflict.
      extentResolved = true;
    } else {
      unresolved.push(
        `The retained ${parent.valueAcres} ac figure (${parent.source}) exceeds the current official ${canonicalAcres} ac and no sibling-parcel arithmetic in evidence closes the difference; the historical extent remains unexplained.`,
      );
      reasoning.push({
        classification: 'CONFLICT',
        statement: `No evidence in hand explains why ${parent.source} carries ${parent.valueAcres} ac against the current official ${canonicalAcres} ac.`,
      });
    }
  }

  // Corroboration: the provider's own mapped-geometry area approximating the
  // current official figure is independent support that the provider's LARGER
  // reported field is a stale roll value, not a different parcel.
  const pcAcres = input.providerCalculated?.acres;
  if (canonicalAcres != null && isAcres(pcAcres) && Math.abs(pcAcres - canonicalAcres) / canonicalAcres <= 0.05) {
    reasoning.push({
      classification: 'INTERPRETATION',
      statement: `${input.providerCalculated!.source} (${pcAcres} ac) approximates the current official ${canonicalAcres} ac, indicating the provider's mapped geometry already reflects the current parcel while its reported acreage field does not.`,
    });
  }

  // ---- Parcel extent statement.
  let parcelExtent: string | null = null;
  if (officialUsable) {
    const pieces = input.gis?.featureCount;
    parcelExtent = `Current official records carry APN ${input.subjectApn} as one tax parcel of ${canonicalAcres} ac`
      + (pieces === 1 && !gisStale ? ', depicted as a single polygon in the county GIS' : '')
      + (extentSiblings.length ? `; ${extentSiblings.map((s) => `parcel ${s.officialParcelId} (${s.legalAcres} ac)`).join(' and ')} ${extentSiblings.length === 1 ? 'is' : 'are'} separately assessed` : '')
      + '.';
  }

  // ---- Status.
  let status: AcreageExtentStatus;
  if (officialUsable && (largerFigures.length === 0 || extentResolved)) {
    status = largerFigures.length && extentSiblings.length ? 'resolved_current_vs_historical_extent' : 'resolved_current_canonical';
  } else if (officialUsable) {
    status = 'partially_resolved';
    confidence = 'confirmed'; // the CURRENT acreage is confirmed even when history is not explained
  } else {
    status = 'unresolved';
  }

  const canonicalChanged = canonicalAcres != null
    && input.priorCanonicalAcres != null
    && Math.abs(canonicalAcres - input.priorCanonicalAcres) > 0.005;

  if (canonicalAcres != null) {
    reasoning.push({
      classification: 'CURRENT CONCLUSION',
      statement: `Canonical current acreage: ${canonicalAcres} ac (official reported, ${official!.source}).`
        + (canonicalChanged ? ` This replaces the previously carried ${input.priorCanonicalAcres} ac; the prior figure stays retained as evidence.` : '')
        + (extentExplanation ? '' : largerFigures.length ? ' The larger retained figures remain unexplained.' : ''),
    });
  }

  const staleProducts = canonicalChanged ? [...ACREAGE_DEPENDENT_PRODUCTS] : [];

  return {
    status,
    canonicalAcres,
    canonicalValueType: canonicalAcres != null ? 'official_reported' : null,
    canonicalSource: canonicalAcres != null ? official!.source : null,
    canonicalSourceUrl: canonicalAcres != null ? official!.sourceUrl : null,
    canonicalRetrievedAt: canonicalAcres != null ? official!.retrievedAt : null,
    confidence,
    parcelExtent,
    extentExplanation,
    extentSiblings,
    retained,
    reasoning,
    canonicalChanged,
    staleProducts,
    unresolvedQuestions: unresolved,
  };
}
