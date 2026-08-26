// LandOS — reconciling the property file before anything reasons over it.
//
// Every capability answers its own question honestly, and they still disagree.
// The assessor's acreage is not the deed's acreage. The parcel sidebar's road
// frontage is not the frontage the access lane measured. A historical planning
// packet states a zoning district the current-zoning determination refuses to
// adopt. Each of those is a correct output of its own lane and a hazard to a
// reader who sees only one of them.
//
// The failure this module prevents is silent selection: an intelligence layer
// that reads two frontage numbers, prints one, and lets an operator size a
// subdivision on it. So the rule here is deliberately narrow:
//
//   • Detect disagreement on facts that MATERIALLY change an acquisition
//     decision — acreage, frontage, access, jurisdiction, zoning, improvements,
//     valuation, and property identity.
//   • Carry every value with the source that stated it.
//   • Resolve ONLY where LandOS's own established provenance already ranks one
//     source above the other, and say which rule did it.
//   • Otherwise state plainly that the fact is not established, and what
//     relying on it would put at risk.
//
// It never invents a tie-break, never averages, and never drops the weaker
// value. "Unresolved, and here is why it matters" is the correct output.

import { at, num, text } from './acquisition-intelligence-dossier.js';

export type MaterialFactSubject =
  | 'acreage'
  | 'frontage'
  | 'access'
  | 'jurisdiction'
  | 'zoning'
  | 'improvements'
  | 'valuation'
  | 'identity';

export interface MaterialFactValue {
  /** What the source says, as the operator should read it. */
  value: string;
  /** Which retained source said it. */
  source: string;
}

export interface MaterialFactConflict {
  subject: MaterialFactSubject;
  /** One sentence naming the disagreement and both values. */
  statement: string;
  values: MaterialFactValue[];
  /** 'resolved' only when LandOS's own provenance ranks one source higher. */
  resolution: 'resolved' | 'unresolved';
  /** The provenance rule that resolved it, or why nothing could. */
  reason: string;
  /** What an operator would get wrong by assuming one value. */
  decisionAtRisk: string;
}

/** Numeric disagreement worth an operator's attention: more than a rounding
 *  difference between two sources measuring the same thing. */
function materiallyDifferent(a: number, b: number): boolean {
  const high = Math.max(Math.abs(a), Math.abs(b));
  if (high === 0) return false;
  const relative = Math.abs(a - b) / high;
  return relative > 0.02;
}

const fmt = (value: number): string =>
  (Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, ''));

interface Source {
  propertyIntelligence?: unknown;
  marketContext?: unknown;
  dealCard?: unknown;
  acreageExtent?: unknown;
}

/**
 * Every material conflict the retained property file currently carries.
 *
 * Pure: it reads the projection it is handed and nothing else.
 */
export function reconcileMaterialFacts(source: Source): MaterialFactConflict[] {
  const pi = source.propertyIntelligence;
  const snapshot = at(pi, 'snapshot');
  const lpf = at(pi, 'landPortalFacts');
  const access = at(pi, 'access');
  const development = at(pi, 'developmentIntelligence');
  const lui = at(pi, 'landUseIntelligence');
  const gis = at(pi, 'officialParcelGis');
  const cv = at(pi, 'compsValuation');
  const conflicts: MaterialFactConflict[] = [];

  // ── Acreage ─────────────────────────────────────────────────────────────
  // Assessed, deeded, GIS-computed and working-valuation acreages all exist
  // and are all legitimately different measurements of the same parcel.
  {
    const candidates: Array<MaterialFactValue & { acres: number }> = [];
    const push = (value: unknown, source: string) => {
      const acres = num(value);
      if (acres != null && acres > 0) candidates.push({ acres, value: `${fmt(acres)} ac`, source });
    };
    const canonicalExtentAcres = num(at(source.acreageExtent, 'decision.canonicalAcres'));
    const canonicalExtentSource = text(at(source.acreageExtent, 'decision.canonicalSource'), 160);
    if (canonicalExtentAcres != null) {
      push(canonicalExtentAcres, `Canonical acreage reconciliation${canonicalExtentSource ? ` (${canonicalExtentSource})` : ''}`);
    }
    const basis = text(at(snapshot, 'identity.acreageBasis'), 40);
    push(at(snapshot, 'identity.acres'), `Canonical parcel identity${basis ? ` (${basis})` : ''}`);
    push(at(lpf, 'acres'), 'LandPortal parcel record');
    push(at(gis, 'acres'), 'Official county GIS parcel record');
    push(at(cv, 'summary.workingAcres'), 'Valuation working acreage');

    const distinct = candidates.filter((candidate, index) =>
      candidates.findIndex((other) => !materiallyDifferent(other.acres, candidate.acres)) === index);
    if (distinct.length > 1) {
      const adoptedCanonical = canonicalExtentAcres == null
        ? null
        : distinct.find((candidate) => !materiallyDifferent(candidate.acres, canonicalExtentAcres));
      const official = adoptedCanonical ?? distinct.find((candidate) => /GIS/i.test(candidate.source));
      conflicts.push({
        subject: 'acreage',
        statement: `Retained acreage differs across sources: ${distinct.map((candidate) => `${candidate.value} (${candidate.source})`).join(' vs ')}.`,
        values: distinct.map(({ value, source: from }) => ({ value, source: from })),
        resolution: official ? 'resolved' : 'unresolved',
        reason: adoptedCanonical
          ? `The retained official acreage/extent reconciliation establishes ${adoptedCanonical.value} as the current parcel. Other figures remain provenance or historical extent, not competing current acreage.`
          : official
          ? `The official county GIS parcel record outranks the other retained sources for parcel area, so ${official.value} is the working acreage.`
          : 'No retained source outranks the others for parcel area: assessed, listed and valuation acreages are different measurements, not a stronger and a weaker one.',
        decisionAtRisk: 'Price per acre, total value and any lot-yield arithmetic all scale directly with the acreage chosen.',
      });
    }
  }

  // ── Road frontage ───────────────────────────────────────────────────────
  // The single most consequential number for a frontage-split strategy, and
  // routinely stated differently by the parcel record and the access lane.
  {
    const candidates: Array<MaterialFactValue & { feet: number }> = [];
    const push = (value: unknown, source: string) => {
      const feet = num(value);
      if (feet != null && feet > 0) candidates.push({ feet, value: `${fmt(feet)} ft`, source });
    };
    push(at(access, 'frontageFt'), 'LandOS access read');
    push(at(lpf, 'access.roadFrontageFt'), 'LandPortal parcel record');

    const distinct = candidates.filter((candidate, index) =>
      candidates.findIndex((other) => !materiallyDifferent(other.feet, candidate.feet)) === index);
    if (distinct.length > 1) {
      const low = Math.min(...distinct.map((candidate) => candidate.feet));
      const high = Math.max(...distinct.map((candidate) => candidate.feet));
      conflicts.push({
        subject: 'frontage',
        statement: `Retained frontage evidence conflicts at approximately ${fmt(low)}–${fmt(high)} ft: ${distinct.map((candidate) => `${candidate.value} (${candidate.source})`).join(' vs ')}. Exact frontage is not established.`,
        values: distinct.map(({ value, source: from }) => ({ value, source: from })),
        resolution: 'unresolved',
        reason: 'Neither retained source is a survey or a recorded plat, so nothing in the file ranks one frontage measurement above the other.',
        decisionAtRisk: 'Frontage sets how many lots can front the existing public road, so subdivision yield must not be relied on until it is confirmed.',
      });
    }
  }

  // ── Access ──────────────────────────────────────────────────────────────
  // Acquisition-screening access and recorded/title verification are separate
  // questions. A road/frontage + not-landlocked read establishes ordinary
  // operator access; lack of a retained deed instrument remains diligence and
  // is not a competing current conclusion.
  {
    const landLocked = text(at(lpf, 'access.landLocked'), 20);
    const verifiedLegal = at(access, 'evidence.verifiedLegalAccess') === true;
    const reportedLegal = at(access, 'evidence.reportedLegalAccess') === true;
    const claimsAccess = /^no$/i.test(landLocked ?? '') || /\byes\b/i.test(text(at(access, 'legalAccess'), 80) ?? '');
    const screeningEstablished = at(access, 'established') === true;
    if (claimsAccess && !screeningEstablished && !verifiedLegal) {
      conflicts.push({
        subject: 'access',
        statement: `The parcel record reports access${landLocked ? ` (land locked: ${landLocked})` : ''}, but no recorded instrument establishing legal access has been retained.`,
        values: [
          { value: landLocked ? `Land locked: ${landLocked}` : 'Access reported', source: 'LandPortal parcel record' },
          {
            value: verifiedLegal ? 'Verified legal access' : reportedLegal ? 'Reported legal access only' : 'Legal access not evidenced',
            source: 'LandOS access evidence ladder',
          },
        ],
        resolution: 'unresolved',
        reason: 'The retained property file does not carry enough road/frontage evidence to establish ordinary acquisition-screening access.',
        decisionAtRisk: 'Ordinary acquisition screening needs a credible way in; recorded/title confirmation remains later diligence after screening access is established.',
      });
    }
  }

  // ── Zoning ──────────────────────────────────────────────────────────────
  // A historical packet stating a district is not the current district. The
  // current-zoning determination already refuses to adopt it; the conflict is
  // surfaced so nobody reads the historical value as today's answer.
  {
    const established = at(lui, 'currentZoning.established') === true;
    const historical = (Array.isArray(at(lui, 'currentZoning.references')) ? at(lui, 'currentZoning.references') as unknown[] : [])
      .map((ref) => ({ kind: text(at(ref, 'kindLabel'), 60), value: text(at(ref, 'value'), 60), asOf: text(at(ref, 'asOf'), 60) }))
      .filter((ref): ref is { kind: string | null; value: string; asOf: string | null } => !!ref.value);
    const distinctDistricts = [...new Set(historical.map((ref) => ref.value))];
    if (!established && distinctDistricts.length > 0) {
      conflicts.push({
        subject: 'zoning',
        statement: `Current zoning is not established, while the retained record names ${distinctDistricts.length === 1 ? 'a district' : 'districts'} historically: ${distinctDistricts.slice(0, 4).join(', ')}.`,
        values: [
          { value: 'Current district unresolved', source: 'LandOS current-zoning determination' },
          ...historical.slice(0, 4).map((ref) => ({
            value: `${ref.value}${ref.kind ? ` — ${ref.kind}` : ''}${ref.asOf ? `, as of ${ref.asOf}` : ''}`,
            source: 'Retained government document',
          })),
        ],
        resolution: 'resolved',
        reason: 'A district stated in a historical document, or one merely requested, is never the current district. LandOS reports current zoning as unresolved until a current parcel-specific official source establishes it.',
        decisionAtRisk: 'By-right use, minimum lot area and subdivision yield all follow the CURRENT district; using a historical or requested district would overstate what is allowed today.',
      });
    }
  }

  // ── Jurisdiction ────────────────────────────────────────────────────────
  {
    const zoningAuthority = text(at(lui, 'currentZoning.authorityName'), 120)
      ?? text(at(lui, 'authority.municipality'), 120);
    const subdivisionAuthority = text(at(lui, 'subdivision.authorityName'), 120);
    const key = (value: string | null) => [...new Set(
      ((value ?? '').toLowerCase().match(/[a-z]+/g) ?? [])
        .filter((token) => !/^(?:city|county|of|official|zoning|map|public|character|districts?|planning|codes?|municipal|commission)$/.test(token)),
    )].join('');
    if (zoningAuthority && subdivisionAuthority && key(zoningAuthority) !== key(subdivisionAuthority)) {
      conflicts.push({
        subject: 'jurisdiction',
        statement: `Zoning and subdivision are administered by different governments: ${zoningAuthority} for zoning, ${subdivisionAuthority} for subdivision.`,
        values: [
          { value: zoningAuthority, source: 'Controlling zoning authority' },
          { value: subdivisionAuthority, source: 'Controlling subdivision authority' },
        ],
        resolution: 'resolved',
        reason: 'Split administration is normal, not an error: a city may zone a parcel while the county reviews its plats. Both rule sets apply.',
        decisionAtRisk: 'Approaching only one government would miss half the approval path and its standards.',
      });
    }
  }

  // ── Improvements ────────────────────────────────────────────────────────
  {
    const parcelImproved = at(lpf, 'improvement.improved');
    const valuationImproved = at(cv, 'subjectImprovement.improved');
    const currentImprovement = text(at(development, 'currentTruth.improvementStatus'), 120);
    const officialNoBuilding = /no_current_building|no buildings/i.test(currentImprovement ?? '');
    if (typeof parcelImproved === 'boolean' && typeof valuationImproved === 'boolean'
      && parcelImproved !== valuationImproved) {
      conflicts.push({
        subject: 'improvements',
        statement: `The parcel record and the valuation disagree on whether the subject is improved: parcel record says ${parcelImproved ? 'improved' : 'vacant'}, valuation treats it as ${valuationImproved ? 'improved' : 'vacant land'}.`,
        values: [
          { value: parcelImproved ? 'Improved' : 'Vacant', source: 'LandPortal parcel record' },
          { value: valuationImproved ? 'Improved' : 'Vacant land', source: 'LandOS valuation scope' },
        ],
        resolution: officialNoBuilding ? 'resolved' : 'unresolved',
        reason: officialNoBuilding
          ? 'The current official assessor reconciliation establishes no current building. The older provider improvement claim remains retained as superseded property history.'
          : 'Neither source is a physical inspection, and the valuation scope and the parcel record are describing the subject at different times.',
        decisionAtRisk: 'Whether the value is a land value or a whole-property value, and whether land comps alone can price the deal.',
      });
    }
  }

  // ── Valuation ───────────────────────────────────────────────────────────
  // The LandPortal estimate is an indication, never the LandOS working value.
  // A wide gap between them is worth stating rather than averaging away.
  {
    const fmv = num(at(cv, 'summary.fmv'));
    const lpEstimate = num(at(cv, 'lpEstimate.price'));
    if (fmv != null && lpEstimate != null && fmv > 0 && lpEstimate > 0
      && Math.abs(fmv - lpEstimate) / Math.max(fmv, lpEstimate) > 0.2) {
      conflicts.push({
        subject: 'valuation',
        statement: `The LandOS comp-based value and the LandPortal estimate differ materially: ${fmt(fmv)} vs ${fmt(lpEstimate)}.`,
        values: [
          { value: String(fmt(fmv)), source: 'LandOS comp-based valuation' },
          { value: String(fmt(lpEstimate)), source: 'LandPortal LP Estimate' },
        ],
        resolution: 'resolved',
        reason: 'The LandPortal estimate is an additional source indication only; the LandOS comp-based valuation remains the working value.',
        decisionAtRisk: 'Offer level and expected resale both key off the working value, not the portal estimate.',
      });
    }
  }

  // ── Identity ────────────────────────────────────────────────────────────
  // Identity conflicts are the one class that stops downstream work entirely,
  // so they are surfaced first-class rather than folded into a note.
  {
    const stated = (Array.isArray(at(snapshot, 'identity.conflicts')) ? at(snapshot, 'identity.conflicts') as unknown[] : [])
      .map((conflict) => text(isRecordLike(conflict) ? (conflict.statement ?? conflict.label) : conflict, 300))
      .filter((value): value is string => !!value);
    for (const statement of stated) {
      conflicts.push({
        subject: 'identity',
        statement,
        values: [{ value: statement, source: 'Canonical parcel identity' }],
        resolution: 'unresolved',
        reason: 'Parcel identity is a hard gate: an unresolved identity conflict is never resolved by downstream research.',
        decisionAtRisk: 'Every fact attached to this card describes the subject only if the parcel is the right one.',
      });
    }
    const gisMatch = text(at(gis, 'parcelMatch'), 60);
    if (gisMatch && /conflict|mismatch/i.test(gisMatch)) {
      conflicts.push({
        subject: 'identity',
        statement: `The official GIS parcel match is reported as "${text(at(gis, 'parcelMatchLabel'), 120) ?? gisMatch}".`,
        values: [{ value: gisMatch, source: 'Official county GIS parcel record' }],
        resolution: 'unresolved',
        reason: 'A GIS parcel-match conflict is an identity question, not a data-quality footnote.',
        decisionAtRisk: 'Government rules and history would be attached to the wrong parcel.',
      });
    }
  }

  return conflicts;
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
