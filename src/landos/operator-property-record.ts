// Operator Property Record: ONE reconciliation pass that turns every stored
// research result into the decision surface the CRM Deal Card renders.
//
// This module is pure: it receives the persisted public-intelligence run plus
// lightweight card/comp/market context and returns operator verdicts. It never
// invents facts: every verdict cites the screening basis and keeps the
// screening-vs-official distinction. UI sections must read these verdicts
// instead of re-deriving their own.

import { sanitizeAccessLanguage } from './evidence-language.js';
import { formatCountyLabel } from './fact-format.js';
import { computePricingGate, type PricingGate } from './strategy-readiness.js';
import { buildAcreageBasis, checkOverlayConsistency, pinOverlayAcresToGeometry, type AcreageReconciliation } from './acreage-basis.js';
import { computeResearchCompleteness, type LaneSignal, type ResearchCompleteness } from './research-completeness.js';
import type {
  CountyRecordsFinding,
  FemaFloodFinding,
  FrontageFinding,
  PublicIntelligenceRun,
  SlopeFinding,
  SoilsSepticFinding,
  UtilitiesFinding,
  WetlandsFinding,
  ZoningLandUseFinding,
} from './public-property-intelligence.js';

export type Verdict = 'good' | 'caution' | 'risk' | 'unknown';
export type SepticOutlook = 'favorable' | 'mixed' | 'poor' | 'unknown';

export interface OperatorDecisionCard {
  key: string;
  label: string;
  verdict: Verdict;
  headline: string;
  detail: string;
  basis: string;
}

export type AgentWorkState = 'completed' | 'researching' | 'blocked' | 'tyler_decision';

export interface AgentWorkItem {
  title: string;
  state: AgentWorkState;
  note: string;
}

// ── Owner-text analysis ───────────────────────────────────────────────────────
// County owner strings are frequently truncated or malformed ("… TRUSTEES
// (HARRY COLEMAN FAMILY"). The raw official value is preserved as evidence; a
// clean operator label is derived; and a malformed/trust string is NEVER
// presented as a fully confirmed owner identity.

export interface OwnerAnalysis {
  /** Clean operator-facing label (e.g. "Coleman family trustees"). */
  display: string | null;
  /** The raw official value, preserved verbatim as evidence. */
  raw: string | null;
  /** True when the raw text appears cut off / malformed. */
  malformed: boolean;
  warnings: string[];
}

export function analyzeOwnerText(rawIn: string | null | undefined): OwnerAnalysis {
  const raw = (rawIn ?? '').replace(/\s+/g, ' ').trim() || null;
  if (!raw) return { display: null, raw: null, malformed: false, warnings: [] };
  const warnings: string[] = [];
  const opens = (raw.match(/\(/g) ?? []).length;
  const closes = (raw.match(/\)/g) ?? []).length;
  const malformed = opens !== closes || /[,&(]$/.test(raw) || /\b(FAMILY|TRUST|AND|OR|OF|THE)$/i.test(raw);
  if (malformed) warnings.push('The official owner text appears truncated or malformed — the complete ownership record must be confirmed from the recorded instruments.');
  const isTrust = /trustee|trust\b/i.test(raw);
  if (isTrust) warnings.push('Ownership is held in trust: current trustees, beneficiary requirements, and authority to sell remain unresolved until the trust instruments are read.');

  let display: string = raw;
  if (isTrust) {
    // Generic clean label: the most repeated surname token reads as the family
    // name ("COLEMAN BARBARA COAXUM MATILDA TRUSTEES (HARRY COLEMAN FAMILY" →
    // "Coleman family trustees"); fall back to the first name token.
    const tokens = raw.toUpperCase().replace(/[^A-Z\s]/g, ' ').split(/\s+/)
      .filter((t) => t.length >= 3 && !/^(TRUSTEE|TRUSTEES|TRUST|FAMILY|THE|AND|OF|FOR|REVOCABLE|LIVING)$/.test(t));
    const freq = new Map<string, number>();
    for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1);
    const repeated = [...freq.entries()].sort((a, b) => b[1] - a[1])[0];
    const family = repeated && repeated[1] >= 2 ? repeated[0] : tokens[0];
    if (family) display = `${family.charAt(0)}${family.slice(1).toLowerCase()} family trustees`;
  }
  return { display, raw, malformed, warnings };
}

// ── Reconciled Land Score ─────────────────────────────────────────────────────
// A Land Score may ONLY be shown when it is computed from the current accepted
// evidence. Each factor cites the exact accepted evidence used; disputed
// acreage caps confidence; wetlands/FEMA/septic/access are never ignored; and
// when inputs are conflicted or missing the score is honestly unavailable.

export interface ReconciledLandScoreFactor {
  id: string;
  label: string;
  maxPoints: number;
  points: number;
  lowestTier: boolean;
  dataGap: boolean;
  basis: string;
}

export interface ReconciledLandScore {
  available: boolean;
  unavailableReason: string | null;
  score: number;
  maxScore: number;
  verdict: 'PURSUE' | 'PURSUE WITH CAUTION' | 'PASS' | null;
  /** False until core screening questions (access, acreage, value, authority) are resolved. */
  decisionReady: boolean;
  /** Operator-facing label — never a positive verdict while core items are unresolved. */
  profileLabel: string;
  confidence: 'full' | 'reduced' | 'severely_reduced';
  factors: ReconciledLandScoreFactor[];
  flags: string[];
  note: string;
}

export interface OperatorPropertyRecord {
  identity: {
    situsAddress: string;
    locality: string | null;
    county: string | null;
    state: string | null;
    zip: string | null;
    apn: string | null;
    /** Clean operator label — never presented as a fully confirmed identity when malformed/trust. */
    owner: string | null;
    /** Raw official owner text, preserved verbatim as evidence. */
    ownerRaw: string | null;
    ownerWarnings: string[];
    ownerMailing: string | null;
    assessedAcres: number | null;
    mappedAcres: number | null;
    acreageConflict: boolean;
    /** Shared canonical acreage & spatial basis — every consumer reads this. */
    acreageBasis: AcreageReconciliation;
    coordinates: { lat: number; lng: number } | null;
    parcelConfidence: string;
    landUseClass: string | null;
    taxArea: string | null;
    legalDescription: string | null;
    lastSale: string | null;
    deedReference: string | null;
    appraisedValue: number | null;
  };
  description: string;
  decisionCards: OperatorDecisionCard[];
  septicOutlook: { outlook: SepticOutlook; why: string; investigateFirst: string | null };
  accessStatus: {
    status: 'public_road_proximity' | 'private_road_only' | 'no_mapped_contact' | 'unknown';
    summary: string;
    concerns: string[];
    /** Every access question that remains open — rendered verbatim so proximity is never oversold. */
    unresolved: string[];
  };
  /** Non-wetland mapped area — NOT usable/buildable acreage (that stays unresolved). */
  usableAcreage: { estimateAcres: number | null; note: string };
  offerReadiness: { state: 'ready' | 'needs_confirmation' | 'blocked' | 'researching'; why: string };
  valueReadiness: { state: 'ready' | 'thin_evidence' | 'not_ready' | 'conflicted'; why: string };
  /** The shared pricing gate (same computation strategy readiness uses). */
  pricingGate: PricingGate;
  /** Core screening lanes with tiered evidence (attempted/retrieved/partial/resolved/confirmed). */
  researchCompleteness: ResearchCompleteness;
  risks: string[];
  unknowns: string[];
  /** Material decisions only Tyler can make (e.g. unresolved acreage basis). */
  tylerDecisions: string[];
  workStatus: AgentWorkItem[];
  sellerQuestions: string[];
  landScore: ReconciledLandScore;
  runCompletedAt: string | null;
}

export interface OperatorRecordContext {
  situsAddress: string;
  county?: string | null;
  state?: string | null;
  apn?: string | null;
  owner?: string | null;
  assessedAcres?: number | null;
  coordinates?: { lat: number; lng: number } | null;
  parcelVerified: boolean;
  verificationSource?: string | null;
  /** Usable (validated) comparable count and whether a defensible range exists. */
  compCount: number;
  valuationReady: boolean;
  /** Material sold-vs-asking (or other basis) valuation conflict — closes pricing. */
  valuationConflict?: boolean;
  /** Supported thin-market local acreage cluster (registry analysis). */
  thinMarketClusterSupported?: boolean;
  /** Reconciliation-level acreage dispute (provider vs official) — closes pricing
   *  exactly like the assessed-vs-mapped conflict computed here. */
  acreageDisputed?: boolean;
  /** Additional acreage bases when known (survey/plat, deed, provider). */
  deededAcres?: number | null;
  surveyedAcres?: number | null;
  providerAcres?: number | null;
  /** The acreage Tyler has explicitly accepted as governing, if any. */
  operatorAcceptedAcres?: number | null;
  marketPulseAvailable: boolean;
  visualsCaptured: number;
  landPortalCaptured: boolean;
  deedRetrieved: boolean;
}

function findingOf<T extends { kind: string }>(run: PublicIntelligenceRun | null | undefined, kind: T['kind']): T | null {
  const task = run?.tasks?.find((entry) => entry.task === kind);
  return task?.finding && task.finding.kind === kind ? task.finding as unknown as T : null;
}

function factValue(county: CountyRecordsFinding | null, field: string): string | null {
  const fact = county?.facts.find((entry) => entry.field.toLowerCase() === field.toLowerCase());
  return fact != null ? String(fact.value) : null;
}

function factNumber(county: CountyRecordsFinding | null, field: string): number | null {
  const raw = factValue(county, field);
  const parsed = raw == null ? NaN : Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function computeSepticOutlook(soils: SoilsSepticFinding | null, utilities: UtilitiesFinding | null): OperatorPropertyRecord['septicOutlook'] {
  if (!soils?.mapUnits.length) return { outlook: 'unknown', why: 'No soil screening result is available yet.', investigateFirst: null };
  const ratings = soils.mapUnits.flatMap((unit) => unit.components.map((component) => component.septicLimitation));
  const rated = ratings.filter((rating) => rating !== 'unknown');
  const sewerAvailable = utilities?.publicSewer === 'mapped_available';
  if (!rated.length) return { outlook: 'unknown', why: 'Soil units were mapped but no septic absorption-field interpretation was published.', investigateFirst: soils.apparentInvestigationAreas ?? null };
  const veryLimited = rated.filter((rating) => rating === 'very_limited').length;
  const notLimited = rated.filter((rating) => rating === 'not_limited').length;
  const share = veryLimited / rated.length;
  const drainage = [...new Set(soils.mapUnits.flatMap((unit) => unit.components.map((component) => component.drainageClass)).filter(Boolean))].slice(0, 3).join(', ');
  if (share >= 0.9) {
    return {
      outlook: 'poor',
      why: `Every mapped soil unit is rated "very limited" for septic absorption fields${drainage ? ` (drainage: ${drainage})` : ''}. A conventional system is unlikely without engineering; an engineered/alternative system and county health approval would be required.${sewerAvailable ? ' Mapped public sewer could remove this constraint if service is confirmed.' : ''}`,
      investigateFirst: soils.apparentInvestigationAreas ?? null,
    };
  }
  // A single mapped component is NEVER described as a "split" or "mixed" set —
  // one rating is one rating. "Split" language and "part of the parcel supports a
  // system" only apply when genuinely different ratings coexist (some very limited
  // AND some not limited).
  if (rated.length === 1) {
    const only = rated[0].replace(/_/g, ' ');
    return {
      outlook: notLimited === 1 ? 'favorable' : 'mixed',
      why: `The single mapped soil component is rated "${only}" for septic absorption fields${drainage ? ` (drainage: ${drainage})` : ''}. This is a SSURGO map-unit limitation, not a site-specific septic determination; feasibility depends on siting and design and a site perc/soil evaluation governs.`,
      investigateFirst: soils.apparentInvestigationAreas ?? null,
    };
  }
  const genuinelySplit = veryLimited > 0 && notLimited > 0;
  if (share >= 0.4 || notLimited === 0) {
    return {
      outlook: 'mixed',
      why: genuinelySplit
        ? `Mapped soils are split: ${veryLimited} of ${rated.length} components are "very limited" and ${notLimited} are "not limited"${drainage ? ` (drainage: ${drainage})` : ''}. Ratings differ across the mapped components; siting matters and a site perc/soil evaluation governs.`
        : `${veryLimited} of ${rated.length} mapped components are "very limited" for septic absorption fields${drainage ? ` (drainage: ${drainage})` : ''}. These are SSURGO map-unit limitations, not a site-specific determination; a site perc/soil evaluation governs feasibility.`,
      investigateFirst: soils.apparentInvestigationAreas ?? null,
    };
  }
  return {
    outlook: 'favorable',
    why: `Most mapped soil components carry low septic limitation (${notLimited} of ${rated.length} rated not limited).`,
    investigateFirst: soils.apparentInvestigationAreas ?? null,
  };
}

/** The open questions the 25 m centerline-proximity method can NEVER answer. */
export const ACCESS_UNRESOLVED_ITEMS = [
  'Parcel–road boundary contact unresolved',
  'Public right-of-way contact unresolved',
  'Mapped frontage unresolved (proximity method does not measure frontage)',
  'Physical / driveway access unresolved',
  'Legal access unresolved (recorded instruments control)',
  'Road maintenance responsibility unresolved',
] as const;

/**
 * Access from road-PROXIMITY screening. The measurement is centerline length
 * within a buffer of the mapped boundary — it is never called "frontage", and
 * it never resolves contact, right-of-way, physical, or legal access.
 */
export function computeAccessStatus(frontage: FrontageFinding | null): OperatorPropertyRecord['accessStatus'] {
  if (!frontage) return { status: 'unknown', summary: 'Road proximity screening has not run yet.', concerns: [], unresolved: [...ACCESS_UNRESOLVED_ITEMS] };
  const proximityPhrase = (road: { name: string; approximateMappedFrontageFt?: number }) =>
    `~${road.approximateMappedFrontageFt ?? '?'} ft of ${road.name.split(' (')[0]} centerline falls within 25 meters of the mapped parcel boundary`;
  const publicRoads = frontage.adjoiningRoads.filter((road) => road.status === 'public');
  const privateRoads = frontage.adjoiningRoads.filter((road) => road.status !== 'public');
  const unresolved = [...ACCESS_UNRESOLVED_ITEMS];
  const intervening = 'Apparent intervening land may exist between the parcel geometry and the visible roadway — adjacency has not been proven.';
  const uniq = (xs: string[]) => [...new Set(xs)];
  if (publicRoads.length) {
    return {
      status: 'public_road_proximity',
      summary: `Road proximity only: ${publicRoads.map(proximityPhrase).join('; ')}.${privateRoads.length ? ` ${privateRoads.map(proximityPhrase).join('; ')} (ownership unverified).` : ''} ${intervening} Parcel–road contact, right-of-way contact, physical access, and legal access are all unresolved.`,
      concerns: uniq([...frontage.accessConcerns.map(sanitizeAccessLanguage), intervening]),
      unresolved,
    };
  }
  if (frontage.adjoiningRoads.length) {
    // A non-public status from the road layer is a weak CLASSIFICATION HINT, not
    // established ownership. Desktop screening never proves a road is private, so
    // ownership is reported as UNKNOWN and a 'private' layer tag is never upgraded
    // to "recorded private-road rights required".
    const privateHint = frontage.adjoiningRoads.some((road) => road.status === 'private');
    return {
      status: 'private_road_only',
      summary: `Road proximity only to ${frontage.adjoiningRoads.length === 1 ? 'a road' : 'roads'} of unknown ownership: ${frontage.adjoiningRoads.map(proximityPhrase).join(', ')}.${privateHint ? ' A road is tagged non-public in the road layer, but ownership is unverified — a classification hint, not proof of a private road.' : ''} Ownership is not established (it may be public, private, or unclassified); recorded private-road rights would only be required if a road is confirmed private, which is unconfirmed.`,
      concerns: uniq(frontage.accessConcerns.map(sanitizeAccessLanguage)),
      unresolved,
    };
  }
  return {
    status: 'no_mapped_contact',
    summary: sanitizeAccessLanguage(frontage.summary),
    concerns: uniq(frontage.accessConcerns.map(sanitizeAccessLanguage)),
    unresolved,
  };
}

export { sanitizeAccessLanguage } from './evidence-language.js';

function floodCard(flood: FemaFloodFinding | null, slope: SlopeFinding | null): OperatorDecisionCard {
  if (!flood) return { key: 'flood', label: 'FEMA Flood', verdict: 'unknown', headline: 'Not screened', detail: 'Flood screening has not run.', basis: '' };
  const sfhaPct = flood.zones.filter((zone) => zone.specialFloodHazardArea).reduce((sum, zone) => sum + zone.parcelPercentage, 0);
  const bfeText = flood.baseFloodElevation ? ` BFE ${flood.baseFloodElevation}.` : '';
  const belowBfe = (() => {
    const bfeNumbers = String(flood.baseFloodElevation ?? '').match(/\d+/g)?.map(Number) ?? [];
    if (!bfeNumbers.length || slope?.maximumElevationFt == null) return '';
    const minBfe = Math.min(...bfeNumbers);
    if (slope.maximumElevationFt < minBfe) return ` Sampled ground (${slope.minimumElevationFt}–${slope.maximumElevationFt} ft) is entirely below the base flood elevation.`;
    if ((slope.minimumElevationFt ?? 0) < minBfe) return ` Much of the sampled ground (from ${slope.minimumElevationFt} ft) sits below the ${minBfe} ft base flood elevation.`;
    return '';
  })();
  if (sfhaPct >= 50) {
    return {
      key: 'flood', label: 'FEMA Flood', verdict: 'risk',
      headline: `${Math.round(sfhaPct)}% in SFHA (${flood.zones.filter((z) => z.specialFloodHazardArea).map((z) => z.zone).join(', ')})`,
      detail: `${flood.zones.map((zone) => `${zone.zone}: ${zone.parcelPercentage}% (${zone.approximateAcres} ac)`).join('; ')}.${bfeText}${belowBfe} Building here typically needs elevation and flood insurance.`,
      basis: 'County/FEMA flood layer, exact parcel overlay (screening).',
    };
  }
  if (sfhaPct > 0) {
    return {
      key: 'flood', label: 'FEMA Flood', verdict: 'caution',
      headline: `${Math.round(sfhaPct)}% in SFHA`,
      detail: `${flood.zones.map((zone) => `${zone.zone}: ${zone.parcelPercentage}%`).join('; ')}.${bfeText}${belowBfe}`,
      basis: 'County/FEMA flood layer, exact parcel overlay (screening).',
    };
  }
  return {
    key: 'flood', label: 'FEMA Flood', verdict: flood.zones.length ? 'caution' : 'good',
    headline: flood.zones.length ? flood.zones.map((zone) => `${zone.zone} ${zone.parcelPercentage}%`).join(', ') : 'No mapped flood zone',
    detail: flood.summary,
    basis: 'County/FEMA flood layer (screening).',
  };
}

function buildReconciledLandScore(input: {
  parcelVerified: boolean;
  wetlandPct: number | null;
  wetlandBasis: string;
  sfhaPct: number | null;
  floodBasis: string;
  septicOutlook: SepticOutlook;
  accessStatus: OperatorPropertyRecord['accessStatus']['status'];
  meanSlopePct: number | null;
  slopeBasis: string;
  acreageConflict: boolean;
  assessedAcres: number | null;
  mappedAcres: number | null;
  valuationReady: boolean;
  compCount: number;
  anyScreenRan: boolean;
  ownerWarnings: string[];
}): ReconciledLandScore {
  const empty: ReconciledLandScore = {
    available: false, unavailableReason: null, score: 0, maxScore: 100, verdict: null,
    decisionReady: false, profileLabel: 'Screening score only — not decision-ready',
    confidence: 'severely_reduced', factors: [], flags: [], note: '',
  };
  if (!input.parcelVerified) {
    return { ...empty, unavailableReason: 'Land Score unavailable — the parcel identity is not confirmed; nothing may be scored from unverified data.' };
  }
  if (!input.anyScreenRan) {
    return { ...empty, unavailableReason: 'Land Score unavailable because current inputs are incomplete — the physical screening lanes have not produced accepted evidence yet.' };
  }

  const factors: ReconciledLandScoreFactor[] = [];
  const tiered = (pct: number, max: number): { points: number; lowestTier: boolean } => {
    if (pct >= 75) return { points: 0, lowestTier: true };
    if (pct >= 50) return { points: Math.round(max * 0.2), lowestTier: false };
    if (pct >= 30) return { points: Math.round(max * 0.4), lowestTier: false };
    if (pct >= 15) return { points: Math.round(max * 0.6), lowestTier: false };
    if (pct >= 5) return { points: Math.round(max * 0.8), lowestTier: false };
    return { points: max, lowestTier: false };
  };

  if (input.wetlandPct != null) {
    const t = tiered(input.wetlandPct, 20);
    factors.push({ id: 'wetlands', label: 'Wetlands', maxPoints: 20, points: t.points, lowestTier: t.lowestTier, dataGap: false, basis: input.wetlandBasis });
  } else {
    factors.push({ id: 'wetlands', label: 'Wetlands', maxPoints: 20, points: 0, lowestTier: false, dataGap: true, basis: 'No accepted wetland screening yet (scored 0, never inferred).' });
  }
  if (input.sfhaPct != null) {
    const t = tiered(input.sfhaPct, 20);
    factors.push({ id: 'flood', label: 'FEMA flood', maxPoints: 20, points: t.points, lowestTier: t.lowestTier, dataGap: false, basis: input.floodBasis });
  } else {
    factors.push({ id: 'flood', label: 'FEMA flood', maxPoints: 20, points: 0, lowestTier: false, dataGap: true, basis: 'No accepted flood screening yet (scored 0, never inferred).' });
  }
  {
    const map: Record<SepticOutlook, { points: number; lowestTier: boolean }> = {
      favorable: { points: 15, lowestTier: false }, mixed: { points: 8, lowestTier: false },
      poor: { points: 2, lowestTier: true }, unknown: { points: 0, lowestTier: false },
    };
    const m = map[input.septicOutlook];
    factors.push({
      id: 'septic', label: 'Septic outlook', maxPoints: 15, points: m.points, lowestTier: m.lowestTier,
      dataGap: input.septicOutlook === 'unknown',
      basis: input.septicOutlook === 'unknown' ? 'No accepted soils screening yet.' : `SSURGO absorption-field screening: ${input.septicOutlook}.`,
    });
  }
  {
    const map: Record<OperatorPropertyRecord['accessStatus']['status'], { points: number; lowestTier: boolean; basis: string }> = {
      // Proximity is NOT contact: while parcel–road contact, right-of-way
      // contact, physical access, and legal access are all unresolved, the
      // factor scores near the floor — proximity alone never earns 10/15.
      public_road_proximity: { points: 4, lowestTier: false, basis: 'Public road mapped nearby (centerline-proximity screening only). Parcel–road contact, right-of-way contact, physical access, and legal access are all unresolved — scored near the floor until any of them is proven.' },
      private_road_only: { points: 3, lowestTier: false, basis: 'Only non-public road proximity mapped; recorded access rights unconfirmed.' },
      no_mapped_contact: { points: 0, lowestTier: true, basis: 'No mapped road proximity — potential landlock until an easement is proven.' },
      unknown: { points: 0, lowestTier: false, basis: 'Road-proximity screening has not run.' },
    };
    const m = map[input.accessStatus];
    factors.push({ id: 'access', label: 'Access (proximity only)', maxPoints: 15, points: m.points, lowestTier: m.lowestTier, dataGap: input.accessStatus === 'unknown', basis: m.basis });
  }
  if (input.meanSlopePct != null) {
    const p = input.meanSlopePct < 5 ? 10 : input.meanSlopePct < 10 ? 7 : input.meanSlopePct < 15 ? 4 : 1;
    factors.push({ id: 'terrain', label: 'Terrain', maxPoints: 10, points: p, lowestTier: p <= 1, dataGap: false, basis: input.slopeBasis });
  } else {
    factors.push({ id: 'terrain', label: 'Terrain', maxPoints: 10, points: 0, lowestTier: false, dataGap: true, basis: 'No accepted terrain sample yet.' });
  }
  {
    const known = input.mappedAcres != null || input.assessedAcres != null;
    const p = !known ? 0 : input.acreageConflict ? 4 : 10;
    factors.push({
      id: 'size_integrity', label: 'Acreage integrity', maxPoints: 10, points: p, lowestTier: false, dataGap: !known,
      basis: !known
        ? 'No acreage basis yet.'
        : input.acreageConflict
          ? `CONFLICTED: assessed ${input.assessedAcres} ac vs mapped ${input.mappedAcres} ac — a survey or recorded plat controls; disputed acreage is never treated as confirmed.`
          : `Acreage consistent across sources (${input.mappedAcres ?? input.assessedAcres} ac).`,
    });
  }
  {
    const p = input.valuationReady ? 10 : input.compCount > 0 ? 4 : 0;
    factors.push({
      id: 'value_evidence', label: 'Value evidence', maxPoints: 10, points: p, lowestTier: p === 0, dataGap: false,
      basis: input.valuationReady ? 'Validated multi-comp value basis exists.' : input.compCount > 0 ? `${input.compCount} usable comp(s) — not yet a defensible band.` : 'No usable comps yet.',
    });
  }

  const score = factors.reduce((s, f) => s + f.points, 0);
  const gaps = factors.filter((f) => f.dataGap).length;
  const flags: string[] = [];
  if (input.acreageConflict) flags.push(`Acreage conflict (assessed ${input.assessedAcres} ac vs mapped ${input.mappedAcres} ac) caps confidence until resolved.`);
  if (input.septicOutlook === 'poor') flags.push('Septic outlook poor — every mapped soil rating is very limited for absorption fields.');
  if ((input.sfhaPct ?? 0) >= 50) flags.push(`Flood: ~${Math.round(input.sfhaPct!)}% of the parcel is in the Special Flood Hazard Area.`);
  if ((input.wetlandPct ?? 0) >= 20) flags.push(`Wetlands: ~${Math.round(input.wetlandPct!)}% of the mapped geometry is mapped wetland.`);
  if (input.accessStatus !== 'unknown') flags.push('Access: parcel–road contact, right-of-way contact, physical access, and legal access are unresolved (proximity screening only).');
  if (!input.valuationReady) flags.push(input.compCount > 0 ? `Value evidence: only ${input.compCount} usable observation(s) — not a defensible basis.` : 'Value evidence: no usable comps yet.');
  for (const w of input.ownerWarnings) flags.push(w);
  for (const f of factors.filter((x) => x.dataGap)) flags.push(`${f.label}: not yet screened (scored 0, never inferred).`);

  const confidence: ReconciledLandScore['confidence'] = gaps >= 4 ? 'severely_reduced' : gaps >= 2 || input.acreageConflict ? 'reduced' : 'full';

  // A screening score is never a decision. Desktop screening cannot resolve
  // legal access, legal acreage, or authority — those are recorded-instrument
  // and field events — so a reconciled screening score is never decision-ready.
  const decisionReady = false;
  const lowestTiers = factors.filter((f) => f.lowestTier).length;
  const highRisk = lowestTiers >= 1 || flags.length >= 4 || input.septicOutlook === 'poor' || (input.sfhaPct ?? 0) >= 50;
  const profileLabel = highRisk ? 'High-risk screening profile' : 'Screening score only — not decision-ready';
  // Verdict is retained for the rubric trail but never rendered as a positive
  // decision label while decisionReady is false.
  const verdict = decisionReady ? (score >= 75 ? 'PURSUE' as const : score >= 50 ? 'PURSUE WITH CAUTION' as const : 'PASS' as const) : null;
  return {
    available: true,
    unavailableReason: null,
    score,
    maxScore: 100,
    verdict,
    decisionReady,
    profileLabel,
    confidence,
    factors,
    flags,
    note: `Screening rubric from the current accepted evidence only (${factors.length - gaps}/${factors.length} factors evidenced${gaps ? `, ${gaps} gap(s) scored 0` : ''}). Confidence ${confidence.replace('_', ' ')}. This is a desktop-screening profile, not completed due diligence and not a pursue/pass decision.`,
  };
}

export function buildOperatorPropertyRecord(rawRun: PublicIntelligenceRun | null | undefined, context: OperatorRecordContext): OperatorPropertyRecord {
  // A screening run whose gate is OFF contributes NO facts: it screened a
  // premise that no longer holds (e.g. wrong_parcel_conflict — the run's
  // parcel does not match the operator-requested identity), and rendering its
  // owner/acreage/value as this lead's identity would be fabricated
  // association. The stored run remains available as history; it just never
  // feeds the operator record.
  const run = (rawRun as { gate?: { allowed?: boolean } } | null | undefined)?.gate?.allowed === false ? null : rawRun;
  const wetlands = findingOf<WetlandsFinding>(run, 'wetlands');
  let flood = findingOf<FemaFloodFinding>(run, 'fema_flood');
  const soils = findingOf<SoilsSepticFinding>(run, 'soils_septic');
  const slope = findingOf<SlopeFinding>(run, 'slope_topography');
  const frontage = findingOf<FrontageFinding>(run, 'road_frontage');
  const zoning = findingOf<ZoningLandUseFinding>(run, 'zoning_landuse');
  const utilities = findingOf<UtilitiesFinding>(run, 'utilities');
  const county = findingOf<CountyRecordsFinding>(run, 'county_records');

  const mappedAcres = factNumber(county, 'GIS mapped acreage');
  // The OFFICIAL county assessed acreage outranks a provider-derived figure —
  // both are preserved (assessed + mapped render side by side when different);
  // a provider value never silently shadows the official record.
  const assessedAcres = factNumber(county, 'Assessed acreage') ?? context.assessedAcres;
  const providerAcres = context.providerAcres ?? factNumber(county, 'Provider acreage');
  // Shared canonical acreage & spatial basis. Every downstream use (display,
  // overlay, valuation, strategy math) resolves its basis from THIS record, so
  // the header, the overlays, and the valuation can never silently use three
  // different acreages. Overlays are pinned to the queried GIS geometry.
  const acreageBasis = buildAcreageBasis({
    assessed: { value: assessedAcres, source: `${formatCountyLabel(context.county) || 'County'} assessor roll` },
    gisGeometry: { value: mappedAcres, source: `${formatCountyLabel(context.county) || 'County'} GIS geometry` },
    deeded: context.deededAcres != null ? { value: context.deededAcres, source: 'Recorded deed' } : null,
    surveyed: context.surveyedAcres != null ? { value: context.surveyedAcres, source: 'Recorded survey/plat' } : null,
    provider: providerAcres != null ? { value: providerAcres, source: 'Data provider' } : null,
    operatorAccepted: context.operatorAcceptedAcres != null ? { value: context.operatorAcceptedAcres, source: 'Tyler accepted' } : null,
  });
  // A material, unresolved acreage basis IS a reconciliation conflict — the same
  // signal the pricing gate and land score already consume, now with an explicit
  // basis record and a discrete Tyler decision.
  const acreageConflict = acreageBasis.disputed
    || (mappedAcres != null && assessedAcres != null && Math.abs(mappedAcres - assessedAcres) / Math.max(assessedAcres, 0.01) > 0.15);
  const baseAcres = mappedAcres ?? assessedAcres ?? null;

  // Overlays are pinned to the queried GIS geometry: a flood zone's acreage is the
  // mapped-geometry area × its parcel percentage, never the assessed acreage. This
  // guarantees the flood overlay can never report more acres than the mapped
  // parcel (the F1 defect: a Zone-X 100% zone displaying the 1.32 assessed ac
  // against a 1.15 ac mapped geometry).
  if (flood && mappedAcres != null) {
    const pinnedZones = pinOverlayAcresToGeometry(flood.zones, mappedAcres);
    // Regenerate the free-text summary so the Zone-X flood card (which renders
    // flood.summary) states the geometry-consistent acreage, not the persisted
    // provider/assessed acreage embedded when the run was first captured.
    const summary = flood.zones.length
      ? `Flood zones cover the parcel: ${pinnedZones.map((z) => `${z.zone} ${z.parcelPercentage}% (${z.approximateAcres} ac)`).join(', ')}${flood.baseFloodElevation ? `; BFE ${flood.baseFloodElevation}` : ''}.`
      : flood.summary;
    flood = { ...flood, zones: pinnedZones, summary };
  }

  const septicOutlook = computeSepticOutlook(soils, utilities);
  const accessStatus = computeAccessStatus(frontage);

  // ── Research completeness across the core screening lanes ──────────────────
  // A lane is "resolved" only when its business question is answered — never
  // merely because a provider executed. Partial evidence (road PROXIMITY without
  // contact/legal access; a county FLOOD layer without FIRM panel/BFE) counts as
  // partial, not resolved, so the card can never present it as completed research.
  const floodHasPanel = !!(flood && flood.panelNumber);
  const laneSignals: LaneSignal[] = [
    { key: 'county', label: 'Official county records', attempted: !!county, dataRetrieved: !!county, businessResolved: !!county, externalConfirmationRequired: false },
    { key: 'wetlands', label: 'Wetlands', attempted: !!wetlands, dataRetrieved: !!wetlands, businessResolved: !!wetlands, externalConfirmationRequired: true, externalConfirmed: false, remaining: wetlands ? null : 'Wetland overlay screening not run' },
    { key: 'flood', label: 'FEMA flood', attempted: !!flood, dataRetrieved: !!flood, businessResolved: floodHasPanel, externalConfirmationRequired: true, externalConfirmed: floodHasPanel && !!flood?.effectiveDate, remaining: floodHasPanel ? null : 'FIRM panel/effective date and BFE availability pending (county-layer screen only)' },
    { key: 'soils', label: 'Soils & septic', attempted: !!soils, dataRetrieved: !!soils, businessResolved: !!soils, externalConfirmationRequired: true, externalConfirmed: false, remaining: soils ? 'SSURGO map-unit screen only; site perc/septic feasibility unconfirmed' : 'Soils screening not run' },
    { key: 'slope', label: 'Slope & terrain', attempted: !!slope, dataRetrieved: !!slope, businessResolved: !!slope, externalConfirmationRequired: false },
    { key: 'access', label: 'Road proximity & access', attempted: !!frontage, dataRetrieved: !!frontage, businessResolved: frontage?.legalAccessStatus === 'confirmed', externalConfirmationRequired: true, externalConfirmed: frontage?.legalAccessStatus === 'confirmed', remaining: frontage?.legalAccessStatus === 'confirmed' ? null : 'Proximity only — parcel–road contact, physical access, and legal access unresolved' },
    { key: 'zoning', label: 'Zoning & land use', attempted: !!zoning, dataRetrieved: !!zoning?.zoningCode, businessResolved: !!zoning?.zoningCode, externalConfirmationRequired: false, remaining: zoning?.zoningCode ? null : 'Zoning code not retrieved' },
    { key: 'utilities', label: 'Utilities', attempted: !!utilities, dataRetrieved: !!utilities, businessResolved: !!utilities, externalConfirmationRequired: true, externalConfirmed: false, remaining: utilities ? 'Service-area availability is a preliminary likelihood; provider confirmation pending' : 'Utility screening not run' },
  ];
  const researchCompleteness = computeResearchCompleteness(laneSignals);

  // ── The shared pricing gate — the SAME computation strategy readiness runs ──
  const pricingGate = computePricingGate({
    parcelVerified: context.parcelVerified,
    validatedSoldComps: context.compCount,
    valuationReady: context.valuationReady,
    valuationConflict: context.valuationConflict ?? false,
    acreageConflict: acreageConflict || (context.acreageDisputed ?? false),
    thinMarketClusterSupported: context.thinMarketClusterSupported ?? false,
  });

  const wetlandPct = wetlands?.approximateParcelPercentage ?? null;
  const wetlandAcres = wetlands?.approximateTotalAcres ?? null;
  const usableEstimate = baseAcres != null && wetlandAcres != null ? Math.max(0, Math.round((baseAcres - wetlandAcres) * 100) / 100) : baseAcres;
  const sfhaPct = flood ? flood.zones.filter((zone) => zone.specialFloodHazardArea).reduce((sum, zone) => sum + zone.parcelPercentage, 0) : null;

  const usableAcreage: OperatorPropertyRecord['usableAcreage'] = {
    estimateAcres: usableEstimate,
    note: baseAcres == null
      ? 'No reliable acreage basis yet.'
      : `Non-wetland mapped area: ~${usableEstimate} ac of ${baseAcres} ac ${mappedAcres != null ? 'mapped geometry' : 'assessed'} (${wetlandAcres ?? 0} ac mapped wetland deducted). This is NOT usable or buildable acreage — buildable/usable acreage is unresolved until access, septic, flood, and wetland constraints are field-confirmed.${acreageConflict ? ` CAUTION: assessed ${assessedAcres} ac vs mapped ${mappedAcres} ac — a survey or recorded plat controls the real size.` : ''}${sfhaPct != null && sfhaPct > 0 ? ` ${Math.round(sfhaPct)}% of the mapped geometry is in the SFHA.` : ''}`,
  };

  // -------------------------------------------------------------- decision cards
  const decisionCards: OperatorDecisionCard[] = [];
  const redFlags: string[] = [];
  if (sfhaPct != null && sfhaPct >= 50) redFlags.push(`${Math.round(sfhaPct)}% Special Flood Hazard Area`);
  if (wetlandPct != null && wetlandPct >= 20) redFlags.push(`${Math.round(wetlandPct)}% mapped wetlands`);
  if (septicOutlook.outlook === 'poor') redFlags.push('all mapped soils rated very limited for septic');
  if (acreageConflict) redFlags.push(`acreage conflict (assessed ${assessedAcres} ac vs mapped ${mappedAcres} ac)`);
  if (accessStatus.status === 'no_mapped_contact') redFlags.push('no mapped road proximity');
  if (accessStatus.status === 'public_road_proximity') redFlags.push('parcel–road contact unresolved (apparent intervening land possible between parcel and roadway)');
  const ownerText = context.owner ?? factValue(county, 'Owner of record');
  const ownerAnalysis = analyzeOwnerText(ownerText);
  if (/trustee|trust\b/i.test(ownerText ?? '')) redFlags.push('trust/trustee ownership — selling authority must be confirmed');
  if (ownerAnalysis.malformed) redFlags.push('official owner record appears truncated/malformed — complete ownership unresolved');

  // Critical red flags have DISTINCT states: flags found; none identified within
  // COMPLETED screening; or critical-risk review incomplete. "None surfaced" may
  // only render when every core screening lane has accepted evidence — not
  // screening a hazard is never presented as the hazard's absence.
  // Outstanding = lanes not yet screened OR screened but not business-resolved
  // (partial). Partial evidence (proximity-only access, county-layer flood without
  // panel) is NEVER treated as completed research, so no favorable all-clear can
  // render while access/title/acreage/zoning/flood material questions are open.
  const outstandingLanes = [...researchCompleteness.unresolved, ...researchCompleteness.missing];
  const outstandingText = outstandingLanes.length ? outstandingLanes.join(', ') : '';
  if (redFlags.length) {
    decisionCards.push({
      key: 'red_flags', label: 'Critical Red Flags',
      verdict: redFlags.length >= 3 ? 'risk' : 'caution',
      headline: `${redFlags.length} flag${redFlags.length > 1 ? 's' : ''}${researchCompleteness.complete ? '' : ' (review incomplete)'}`,
      detail: redFlags.join('; ') + '.' + (researchCompleteness.complete ? '' : ` Critical-risk review is still incomplete: ${outstandingText} ${outstandingLanes.length === 1 ? 'remains unresolved' : 'remain unresolved'} — more flags may surface.`),
      basis: 'Reconciled from the completed screens.',
    });
  } else if (researchCompleteness.complete) {
    decisionCards.push({
      key: 'red_flags', label: 'Critical Red Flags',
      verdict: 'good',
      headline: 'None within completed screening',
      detail: `No critical red flag was identified within the ${researchCompleteness.resolved}/${researchCompleteness.total} business-resolved screening lanes. Recorded-instrument items (title, legal access) remain separate confirmations.`,
      basis: 'Reconciled from all completed screens.',
    });
  } else {
    decisionCards.push({
      key: 'red_flags', label: 'Critical Red Flags',
      verdict: 'unknown',
      headline: 'Critical-risk review incomplete',
      detail: `${researchCompleteness.resolved} of ${researchCompleteness.total} core lanes are business-resolved.${researchCompleteness.unresolved.length ? ` Screened but unresolved (partial evidence only): ${researchCompleteness.unresolved.join(', ')}.` : ''}${researchCompleteness.missing.length ? ` Not screened yet: ${researchCompleteness.missing.join(', ')}.` : ''} No all-clear can be stated until these resolve.`,
      basis: 'Screening-completeness rule: partial or absent evidence is never a favorable finding.',
    });
  }
  decisionCards.push({
    key: 'septic', label: 'Septic Outlook',
    verdict: septicOutlook.outlook === 'poor' ? 'risk' : septicOutlook.outlook === 'mixed' ? 'caution' : septicOutlook.outlook === 'favorable' ? 'good' : 'unknown',
    headline: septicOutlook.outlook === 'unknown' ? 'Not screened' : septicOutlook.outlook[0].toUpperCase() + septicOutlook.outlook.slice(1),
    detail: septicOutlook.why,
    basis: 'USDA SSURGO absorption-field interpretation (screening; not a perc test).',
  });
  decisionCards.push({
    key: 'wetlands', label: 'Wetlands',
    verdict: wetlandPct == null ? 'unknown' : wetlandPct >= 20 ? 'risk' : wetlandPct > 1 ? 'caution' : 'good',
    headline: wetlands ? (wetlands.intersects ? `${wetlandPct ?? '?'}% mapped (${wetlandAcres ?? '?'} ac)` : 'None mapped') : 'Not screened',
    detail: wetlands?.summary ?? 'Wetland screening has not run.',
    basis: wetlands ? `${wetlands.datasetName} (screening, not a jurisdictional determination).` : '',
  });
  decisionCards.push(floodCard(flood, slope));
  decisionCards.push({
    key: 'access', label: 'Road Proximity & Access',
    verdict: accessStatus.status === 'public_road_proximity' ? 'caution' : accessStatus.status === 'unknown' ? 'unknown' : 'risk',
    headline: accessStatus.status === 'public_road_proximity'
      ? 'Public road nearby — contact & access unresolved'
      : accessStatus.status === 'private_road_only'
        ? 'Non-public road proximity only'
        : accessStatus.status === 'no_mapped_contact' ? 'No mapped road proximity' : 'Not screened',
    detail: accessStatus.summary,
    basis: 'County centerline within 25 m of the mapped boundary (proximity screening; it does not measure frontage, and recorded instruments control legal access).',
  });
  decisionCards.push({
    key: 'zoning', label: 'Zoning',
    verdict: zoning?.zoningCode ? (zoning.overlayDistricts.length ? 'caution' : 'good') : 'unknown',
    headline: zoning?.zoningCode ? `${zoning.zoningName ?? zoning.zoningCode}${zoning.overlayDistricts.length ? ' + overlay' : ''}` : 'Not screened',
    detail: zoning?.summary ?? 'Zoning screening has not run.',
    basis: zoning ? `County zoning + future land use layers (screening).` : '',
  });
  decisionCards.push({
    key: 'utilities', label: 'Utilities',
    verdict: utilities ? (utilities.publicSewer === 'mapped_available' && utilities.publicWater === 'mapped_available' ? 'good' : 'caution') : 'unknown',
    headline: utilities ? `Well ${utilities.wellLikelyRequired ? 'likely required' : 'may not be needed'}; septic ${utilities.septicLikelyRequired ? 'likely required' : 'may not be needed'}` : 'Not screened',
    detail: utilities?.summary ?? 'Utility screening has not run.',
    basis: utilities ? 'County GIS + utility-authority identification (screening).' : '',
  });
  decisionCards.push({
    key: 'usable', label: 'Non-Wetland Mapped Area',
    verdict: usableEstimate == null ? 'unknown' : 'caution',
    headline: usableEstimate != null ? `~${usableEstimate} ac non-wetland (usable acreage unresolved)` : 'Unknown',
    detail: usableAcreage.note,
    basis: 'Mapped parcel area minus exact wetland overlay (screening). Buildable/usable acreage stays unresolved until field confirmation.',
  });
  // Value readiness consumes the SHARED pricing gate — never the registry count
  // alone. A conflicted valuation (sold vs asking materially divergent) or a
  // disputed acreage keeps value readiness closed even with many sold comps.
  const valuationConflicted = (context.valuationConflict ?? false) && context.valuationReady;
  decisionCards.push({
    key: 'value', label: 'Value Readiness',
    verdict: pricingGate.pricingAllowed ? 'good' : valuationConflicted || acreageConflict ? 'caution' : context.compCount > 0 ? 'caution' : 'risk',
    headline: pricingGate.pricingAllowed
      ? 'Comp-supported range available'
      : valuationConflicted
        ? 'Valuation evidence conflicted — pricing blocked'
        : acreageConflict && context.valuationReady
          ? 'Acreage conflicted — pricing blocked'
          : context.compCount === 1
            ? '1 validated sold observation — not a market'
            : context.compCount > 0
              ? `Only ${context.compCount} usable comps`
              : 'No usable comps yet',
    detail: pricingGate.pricingAllowed
      ? 'A defensible range exists on the Market tab.'
      : pricingGate.pricingBlockers.join(' '),
    basis: 'Shared pricing gate over the unique comparable registry (count, conflict, and acreage integrity together). Source confidence and subject comparability are tracked separately per comp.',
  });
  {
    // The Overview strategy card must match the shared strategy record: while
    // the SHARED pricing gate is closed, every one of the five strategies is
    // BLOCKED — never "scoreable". The gate here is byte-for-byte the same
    // computation buildStrategyReadiness runs, so the two can never diverge.
    const screened: string[] = [];
    if (wetlands) screened.push('wetlands');
    if (flood) screened.push('flood');
    if (soils) screened.push('soils/septic');
    if (slope) screened.push('slope sample');
    if (zoning?.zoningCode) screened.push('zoning');
    if (utilities) screened.push('utilities lines');
    const unresolvedCore = ['parcel–road contact', 'legal access', ...(acreageConflict ? ['legal acreage'] : []), ...(!pricingGate.pricingAllowed ? ['value basis'] : [])];
    decisionCards.push({
      key: 'strategy', label: 'Strategy Readiness',
      verdict: pricingGate.pricingAllowed ? 'good' : 'caution',
      headline: pricingGate.pricingAllowed ? 'Scoreable — actionability varies per strategy' : 'All 5 strategies blocked pending evidence',
      detail: pricingGate.pricingAllowed
        ? 'A defensible value basis exists, so strategies can be scored against it. Screening is available for every strategy, but each strategy’s ACTIONABILITY is decided by its own blockers (access, title, acreage, feasibility) on the Strategy tab — scoreable never means every strategy is workable.'
        : `Strategy screening remains available (desktop evidence exists for ${screened.length ? screened.join(', ') : 'no lanes yet'}), but strategies are NOT scoreable and NOT actionable: ${unresolvedCore.join(', ')} remain unresolved. ${pricingGate.pricingBlockers.join(' ')} Every strategy is blocked until the pricing gate opens — missing research never marks a strategy unviable.`,
      basis: 'Shared strategy-readiness record (same statuses the Strategy tab shows).',
    });
  }

  // -------------------------------------------------------------- narrative
  const locality = factValue(county, 'Situs locality (Census county subdivision)');
  const zip = factValue(county, 'Situs ZIP (Census ZCTA)');
  const landUseClass = factValue(county, 'Land use class');
  const descriptionParts: string[] = [];
  // Acreage in the description is the SAME reconciled acreage every calculation
  // uses (context.assessedAcres from the reconciled record / mapped geometry) —
  // never "?" while a numeric acreage drives comps and valuation elsewhere.
  const descAcres = baseAcres != null ? `${baseAcres}-acre` : 'Acreage-unconfirmed';
  const countyLabel = formatCountyLabel(context.county);
  descriptionParts.push(`${descAcres} ${landUseClass ? `${landUseClass.toLowerCase()} ` : ''}parcel${locality ? ` on ${locality}` : ''}${countyLabel ? `, ${countyLabel}, ${context.state ?? ''}` : ''}.`.replace(/\s+,/g, ','));
  if (zoning?.zoningCode) descriptionParts.push(`Zoned ${zoning.zoningName ?? zoning.zoningCode}${zoning.overlayDistricts.length ? ` inside the ${zoning.overlayDistricts.join(' and ')}` : ''}.`);
  if (slope) {
    // Terrain wording derives from the sampled slope — never a hardcoded
    // regional adjective.
    const mean = slope.meanSlopePct;
    const terrainWord = mean == null ? 'Terrain sampled' : mean < 5 ? 'Gently sloped terrain' : mean < 10 ? 'Moderately sloped terrain' : mean < 15 ? 'Notably sloped terrain' : 'Steep terrain';
    descriptionParts.push(`${terrainWord}${mean != null ? ` (~${mean}% mean slope, ` : ' ('}${slope.minimumElevationFt}–${slope.maximumElevationFt} ft elevation).`);
  }
  if (wetlands?.intersects && wetlandPct != null) descriptionParts.push(`About ${Math.round(wetlandPct)}% is mapped wetland/marsh.`);
  if (sfhaPct != null && sfhaPct > 0) descriptionParts.push(`${Math.round(sfhaPct)}% sits in the FEMA Special Flood Hazard Area${flood?.baseFloodElevation ? ` (BFE ${flood.baseFloodElevation})` : ''}.`);
  if (accessStatus.status === 'public_road_proximity') descriptionParts.push(`${frontage?.adjoiningRoads.filter((road) => road.status === 'public').map((road) => road.name.split(' (')[0]).join(' and ')} mapped nearby; parcel–road contact and legal access unresolved.`);
  const description = descriptionParts.join(' ');

  // -------------------------------------------------------------- risks & unknowns
  const risks: string[] = [];
  if (sfhaPct != null && sfhaPct >= 50) risks.push(`Flood: ~${Math.round(sfhaPct)}% of the parcel is Zone ${flood!.zones.filter((z) => z.specialFloodHazardArea).map((z) => z.zone).join('/')}${flood?.baseFloodElevation ? ` with BFE ${flood.baseFloodElevation}` : ''}; sampled ground tops out at ${slope?.maximumElevationFt ?? '?'} ft.`);
  if (wetlandPct != null && wetlandPct >= 10) risks.push(`Wetlands: ~${wetlandAcres} ac (${wetlandPct}%) mapped marsh/wetland reduces usable area${wetlands?.accessOrDevelopmentEffect ? ` — ${wetlands.accessOrDevelopmentEffect.toLowerCase()}` : ''}`);
  if (septicOutlook.outlook === 'poor') risks.push('Septic: every mapped soil unit is rated very limited for absorption fields; buildability depends on an engineered system or confirmed sewer.');
  if (acreageConflict) risks.push(`Size: the assessor lists ${assessedAcres} ac but the mapped boundary measures ${mappedAcres} ac; value math must not assume ${assessedAcres} ac until a survey or plat resolves it.`);
  if (/trustee|trust\b/i.test(ownerText ?? '')) risks.push('Title: ownership is held in trust/by trustees; authority to sell (all trustees/heirs) must be confirmed before contract.');
  if (accessStatus.status !== 'unknown') risks.push(accessStatus.status === 'public_road_proximity'
    ? 'Access: only road PROXIMITY is mapped — parcel–road contact, right-of-way contact, physical access, and legal access are all unresolved, and apparent intervening land may sit between the parcel geometry and the visible roadway.'
    : `Access: ${accessStatus.summary}`);

  const unknowns: string[] = [];
  if (!context.deedRetrieved) unknowns.push(`Recorded deed${factValue(county, 'Deed book/page') ? ` (${factValue(county, 'Deed book/page')})` : ''} and any recorded easements have not been read yet.`);
  // The "zones/BFE screened from the county layer" claim may only render when a
  // flood finding actually exists — never alongside "flood not screened".
  if (flood && !flood.panelNumber) unknowns.push(`FEMA FIRM panel number/effective date not yet retrieved (zones are from the county flood layer${flood.baseFloodElevation ? '; BFE from the county layer' : '; no BFE applies to Zone X / no BFE retrieved'}).`);
  if (!flood) unknowns.push('Flood screening has not run yet — no zone, BFE, or panel information exists for this parcel.');
  if (!context.valuationReady) unknowns.push('Defensible value range pending a validated multi-source comp set.');
  if (zoning && !zoning.minimumLotSize) unknowns.push(`Minimum lot size and subdivision rules for ${zoning.zoningCode ?? 'the zoning district'} require the ordinance text (county planning).`);
  if (utilities?.publicWater === 'unknown') unknowns.push('Water service availability must be confirmed with the utility authority.');

  // -------------------------------------------------------------- acreage basis + overlays
  // Overlay areas are computed against the mapped GIS geometry; a flood/wetland
  // overlay can never report more acreage than the geometry it was sampled
  // against without a documented reason. These issues feed the executive audit.
  const floodOverlayAcres = flood ? flood.zones.reduce((sum, z) => sum + (z.approximateAcres ?? 0), 0) : null;
  const overlayIssues = [
    ...acreageBasis.issues,
    floodOverlayAcres != null ? checkOverlayConsistency({ overlayLabel: 'FEMA flood', overlayAcres: floodOverlayAcres, geometryAcres: mappedAcres }) : null,
    wetlandAcres != null ? checkOverlayConsistency({ overlayLabel: 'Wetlands', overlayAcres: wetlandAcres, geometryAcres: mappedAcres }) : null,
  ].filter((i): i is NonNullable<typeof i> => i != null);
  for (const issue of overlayIssues) {
    if (issue.code === 'overlay_exceeds_geometry') risks.push(`Data integrity: ${issue.message}`);
  }

  // Material decisions only Tyler can make. The acreage basis surfaces its own
  // decision when the size is disputed and unaccepted; never silently resolved.
  const tylerDecisions: string[] = [];
  if (acreageBasis.decision) tylerDecisions.push(acreageBasis.decision);

  // -------------------------------------------------------------- agent work status
  const workStatus: AgentWorkItem[] = [];
  const done = (title: string, note: string) => workStatus.push({ title, state: 'completed', note });
  const researching = (title: string, note: string) => workStatus.push({ title, state: 'researching', note });
  const blocked = (title: string, note: string) => workStatus.push({ title, state: 'blocked', note });
  const decision = (title: string, note: string) => workStatus.push({ title, state: 'tyler_decision', note });

  if (county) done('Official county record', county.summary.split(' NOTE:')[0]);
  if (wetlands) done('Wetland overlay (exact acreage)', wetlands.summary);
  if (flood) done(`Flood overlay screened${flood.baseFloodElevation ? ' (with BFE)' : ' (Zone X / no BFE)'}`, flood.summary);
  if (soils) done('Soils & septic screen', soils.summary);
  if (slope) done('Terrain point sample', slope.summary);
  if (frontage) done('Road proximity geometry', sanitizeAccessLanguage(frontage.summary));
  if (zoning?.zoningCode) done('Zoning & future land use', zoning.summary);
  if (utilities) done('Utility line screening', utilities.summary);
  if (context.visualsCaptured > 0) done('Visual evidence', `${context.visualsCaptured} parcel-tied visuals captured.`);

  if (!context.valuationReady) researching('Comparable sales expansion', `${context.compCount} usable comp(s) so far; expanding validated sold comps and local acreage-cluster evidence across approved sources.`);
  if (!context.marketPulseAvailable) researching('Market Pulse', 'Building the property-specific market read (growth, permits, demand, absorption).');
  if (frontage && accessStatus.status !== 'no_mapped_contact') researching('Parcel–road contact analysis', 'Determining whether the mapped boundary actually touches a public right-of-way, or whether intervening land sits between the parcel and the visible roadway.');
  if (zoning?.zoningCode && !zoning.minimumLotSize) blocked('Zoning ordinance details', `The ${zoning.zoningCode} ordinance text (minimum lot size, frontage, setbacks, density, permitted uses, manufactured-home and subdivision rules) has not been retrieved — the county planning source must publish or respond.`);
  if (utilities && (utilities.publicWater !== 'mapped_available' || utilities.publicSewer !== 'mapped_available')) {
    blocked('Utility service confirmation', 'No county GIS public water/sewer line is mapped at the parcel. Actual service availability requires a response from the regional utility authority and the health authority — external confirmations LandOS cannot complete alone.');
  }
  if (/trustee|trust\b/i.test(ownerText ?? '')) blocked('Trust authority documentation', 'Current trustees, beneficiary requirements, and authority to sell are unresolved. The controlling trust instruments must come from the seller or recorded records — an external document LandOS cannot generate.');
  if (context.deedRetrieved) {
    done('Deed & easement review', `The vesting deed${factValue(county, 'Deed book/page') ? ` (${factValue(county, 'Deed book/page')})` : ''} was retrieved from the public recorder search and scanned page-by-page for easement/reservation/restriction language; findings are on the card evidence.`);
  } else {
    const deedRef = factValue(county, 'Deed book/page');
    blocked(`Deed & easement review${deedRef ? ` (${deedRef})` : ''}`, 'The recorder document image has not been read yet. LandOS will retry via the public recorder search; no fee will be paid without approval.');
  }
  if (flood && !flood.panelNumber) researching('FEMA FIRM panel', `Panel/effective date lookup from the national NFHL service (zones screened from the county layer${flood.baseFloodElevation ? '; BFE from the county layer' : '; no BFE for Zone X / none retrieved'}).`);
  if (!flood) researching('FEMA flood screening', 'Flood screening has not run yet — queued against the county/FEMA flood layer.');
  if (!context.landPortalCaptured) researching('Land Portal capture', 'Authenticated Land Portal parcel/overlay screenshots will be captured when the browser session is available.');
  if (redFlags.length) {
    decision('Pursue or pass at this risk profile', `Screening surfaced: ${redFlags.join('; ')}. Decide whether the price potential justifies survey/perc/title spend.`);
  }
  if (acreageConflict) decision('Order survey (if pursuing)', `Only a survey resolves the ${mappedAcres} vs ${assessedAcres} ac conflict that drives the whole value basis.`);
  if (septicOutlook.outlook === 'poor') decision('Commission septic/perc evaluation (if pursuing)', 'Every mapped soil rating is very limited — only a field evaluation and health-authority ruling resolves buildability.');

  // -------------------------------------------------------------- seller questions
  // Property-specific: every question is derived from what LandOS actually knows
  // and does NOT know about THIS parcel — acreage source, access, flood, septic,
  // utilities, title — with the parcel's own specifics (road name, acreage,
  // county) woven in. Generic filler only where no specific fact applies.
  const sellerQuestions: string[] = [];
  const situsStreet = (context.situsAddress ?? '').split(',')[0]?.replace(/^\s*\d+\s*/, '').trim() || null;
  sellerQuestions.push('Why are you selling, and what timeline are you working toward?');
  sellerQuestions.push('Do you have a price in mind, and who else is involved in the decision?');
  const isTrustOwner = /trustee|trust\b/i.test(ownerText ?? '');
  if (isTrustOwner) {
    sellerQuestions.push('Who are the current trustees, and do you have documented authority for all of them to sign a sale?');
    sellerQuestions.push('Do the beneficiaries need to consent or vote before a sale, and is everyone in the family aligned on selling?');
  }
  if (acreageConflict) {
    sellerQuestions.push(`The county assesses ${assessedAcres} acres but the mapped boundary measures about ${mappedAcres} acres — does the ${assessedAcres}-acre figure include another tract or parcel?`);
  } else if (baseAcres != null && mappedAcres == null) {
    sellerQuestions.push(`Records show about ${baseAcres} acres — does that match your understanding, and does it include any adjoining tract you also own?`);
  } else if (baseAcres == null) {
    sellerQuestions.push('How many acres do you believe the property is, and where does that figure come from (deed, survey, tax bill)?');
  }
  sellerQuestions.push(`Do you have a survey or recorded plat of the property${factValue(county, 'Legal description (assessor)') || factValue(county, 'Deed book/page') ? ' (or the plat referenced in your deed)' : ''}?`);
  if (frontage) {
    sellerQuestions.push(`How do you physically get to the property today — from ${frontage.adjoiningRoads.map((road) => road.name.split(' (')[0]).join(' or ') || 'which road'}? Does that route cross a neighbor's land?`);
  } else {
    sellerQuestions.push(`How do you physically get to the property today${situsStreet ? ` — directly from ${situsStreet}` : ''}? Does the route cross anyone else's land?`);
  }
  sellerQuestions.push('Is there a recorded easement or road maintenance agreement for the access route?');
  if (sfhaPct != null && sfhaPct > 0) {
    sellerQuestions.push('Has the property ever flooded, and does any elevation certificate exist?');
    sellerQuestions.push('Has any fill or grading been done in the flood area?');
  } else if (!flood) {
    sellerQuestions.push('Are you aware of any flooding or standing water on the property? (Flood screening has not run yet.)');
  }
  if (wetlands?.intersects) sellerQuestions.push('Has a wetland delineation ever been performed, or any Corps/DHEC determination requested?');
  else if (!wetlands) sellerQuestions.push('Are there any wet areas, creeks, or drainage paths on the land? (Wetland screening has not run yet.)');
  if (septicOutlook.outlook !== 'favorable') sellerQuestions.push(`Has a perc/soil test ever been done, or a septic permit applied for (approved or denied)?${soils ? '' : ' (Soil screening has not run yet.)'}`);
  if (utilities) sellerQuestions.push('Is there any well, water meter, sewer, or electric service at or near the property today?');
  else sellerQuestions.push('What utilities, if any, are at or near the property today — power, water, sewer, or a well/septic? (Utility screening has not run yet.)');
  if (!zoning?.zoningCode) sellerQuestions.push('Do you know how the property is zoned, or how it has been used in the past? (Zoning has not been retrieved yet.)');
  sellerQuestions.push('Are there any structures, old foundations, or improvements on the land?');
  sellerQuestions.push('Have any building permits been applied for here — approved or denied?');
  sellerQuestions.push('Has anyone else made an offer on this property, and how did that go?');
  if (isTrustOwner) sellerQuestions.push('Is there any family disagreement about selling that we should plan around?');

  const verificationNote = context.parcelVerified
    ? `Verified — ${context.verificationSource ?? 'official parcel record matched'}`
    : 'Unverified';

  return {
    identity: {
      situsAddress: context.situsAddress,
      locality: locality ?? null,
      county: context.county ?? null,
      state: context.state ?? null,
      zip: zip ?? null,
      apn: context.apn ?? null,
      owner: ownerAnalysis.display,
      ownerRaw: ownerAnalysis.raw,
      ownerWarnings: ownerAnalysis.warnings,
      ownerMailing: factValue(county, 'Owner mailing address'),
      assessedAcres: assessedAcres ?? null,
      mappedAcres,
      acreageConflict,
      acreageBasis,
      coordinates: context.coordinates ?? null,
      parcelConfidence: verificationNote,
      landUseClass,
      taxArea: factValue(county, 'Tax district / area'),
      legalDescription: factValue(county, 'Legal description (assessor)'),
      lastSale: factValue(county, 'Last recorded sale date')
        ? `${factValue(county, 'Last recorded sale date')}${factValue(county, 'Last recorded sale price') ? ` for $${Number(factValue(county, 'Last recorded sale price')).toLocaleString()}` : ''}`
        : null,
      deedReference: factValue(county, 'Deed book/page'),
      appraisedValue: factNumber(county, 'Total appraised value'),
    },
    description,
    decisionCards,
    septicOutlook,
    accessStatus,
    usableAcreage,
    // Offer readiness consumes the shared pricing gate AND research
    // completeness — a calculated range alone never advances an offer while
    // material facts (access, septic, zoning, utilities, title) are unresearched.
    offerReadiness: !pricingGate.pricingAllowed
      ? {
          state: !researchCompleteness.complete ? 'researching' : 'blocked',
          why: `Pricing gate closed: ${pricingGate.pricingBlockers.join(' ')}${researchCompleteness.complete ? '' : ` Research also incomplete (${researchCompleteness.missing.join(', ')} pending).`}`,
        }
      : !researchCompleteness.complete
        ? { state: 'researching', why: `A comp-supported range exists, but material research is incomplete: ${researchCompleteness.missing.join(', ')} have not produced accepted evidence. Not ready for an offer decision.` }
        : { state: 'needs_confirmation', why: 'A range exists and screening is complete; title, access, survey, and septic confirmations gate an offer.' },
    valueReadiness: pricingGate.pricingAllowed
      ? { state: 'ready', why: 'The shared pricing gate is open — a comp-supported range exists on the Market tab.' }
      : valuationConflicted || (acreageConflict && context.valuationReady)
        ? { state: 'conflicted', why: pricingGate.pricingBlockers.join(' ') }
        : context.compCount > 0
          ? { state: 'thin_evidence', why: `Only ${context.compCount} usable comp(s); a range from one point is not defensible.` }
          : { state: 'not_ready', why: 'No usable comps retrieved yet.' },
    pricingGate,
    researchCompleteness,
    risks,
    unknowns,
    tylerDecisions,
    workStatus,
    sellerQuestions,
    landScore: buildReconciledLandScore({
      parcelVerified: context.parcelVerified,
      wetlandPct,
      wetlandBasis: wetlands ? `${wetlands.datasetName}: ${wetlandAcres ?? '?'} ac (${wetlandPct ?? '?'}%) of the mapped geometry (screening).` : '',
      sfhaPct,
      floodBasis: flood ? `County/FEMA flood overlay: ${flood.zones.map((z) => `${z.zone} ${z.parcelPercentage}%`).join(', ')}${flood.baseFloodElevation ? `; BFE ${flood.baseFloodElevation}` : ''} (screening).` : '',
      septicOutlook: septicOutlook.outlook,
      accessStatus: accessStatus.status,
      meanSlopePct: slope?.meanSlopePct ?? null,
      slopeBasis: slope ? `Interior grid sample: mean ${slope.meanSlopePct}% slope, relief ${slope.totalReliefFt} ft (screening).` : '',
      acreageConflict,
      assessedAcres: assessedAcres ?? null,
      mappedAcres,
      valuationReady: context.valuationReady,
      compCount: context.compCount,
      anyScreenRan: !!(wetlands || flood || soils || slope || frontage || county),
      ownerWarnings: ownerAnalysis.warnings,
    }),
    runCompletedAt: run?.completedAt ?? null,
  };
}
