// Shared safe-language rules for persisted screening evidence.
//
// Two hard rules the whole Deal Card obeys:
//   1. The 25 m centerline-proximity measurement is NEVER called "frontage".
//      It proves road proximity only — parcel–road contact, right-of-way
//      contact, physical access, and legal access all stay unresolved.
//   2. Point-sample slope statistics NEVER become parcel-wide slope-band
//      acreage. Sixteen interior points are sixteen points, not 7.5 acres.
//
// The sanitizer runs at read AND write time on the persisted public
// intelligence run, so historical provider output can never re-introduce
// unsafe conclusions into current tabs — without deleting the evidence.

import type { FrontageFinding, PublicIntelligenceRun, SlopeFinding } from './public-property-intelligence.js';

/** Rewrite screening strings so the proximity method is never called frontage,
 *  and so a non-public road-layer tag is never asserted as established private
 *  ownership (ws2-r5): "unknown" rather than "private" until ownership is proven. */
export function sanitizeAccessLanguage(text: string): string {
  return text
    // A road-layer 'private' tag is a classification hint, not established
    // ownership — neutralize legacy persisted claims that assert it.
    .replace(/\bis mapped as a private road\b/gi, 'carries a non-public/private tag in the road layer, but ownership is unverified')
    .replace(/\brecorded access rights over it are required( and are not confirmed by GIS)?/gi, 'recorded access rights would be required only if it is confirmed private (unconfirmed by GIS)')
    .replace(/~?(\d[\d,]*)\s*ft\s+mapped\s+frontage/gi, '~$1 ft of road centerline within 25 m of the mapped boundary')
    .replace(/mapped\s+(?:public-road\s+)?frontage/gi, 'mapped road proximity')
    .replace(/apparent\s+public\s+frontage/gi, 'public-road proximity (contact unresolved)')
    .replace(/parcel fronts a paved road/gi, 'a paved road is mapped nearby; direct parcel–road contact unresolved')
    .replace(/centerline\s+frontage/gi, 'centerline proximity')
    .replace(/road\s+frontage/gi, 'road proximity')
    .replace(/\bfrontage\b/gi, 'road proximity');
}

const ACCESS_UNRESOLVED_NOTE =
  'Parcel–road boundary contact, public right-of-way contact, mapped frontage, physical/driveway access, legal access, and road maintenance all remain unresolved; the centerline-proximity method cannot resolve them.';

function sanitizeFrontageFinding(finding: FrontageFinding): FrontageFinding {
  const roads = finding.adjoiningRoads.map((road) => ({ ...road, apparentRightOfWayContact: null }));
  const proximityParts = roads.map((road) =>
    `~${road.approximateMappedFrontageFt ?? '?'} ft of ${road.name.split(' (')[0]} centerline falls within 25 meters of the mapped parcel boundary${road.status !== 'public' ? ' (non-public)' : ''}`);
  const concerns = [...new Set([...finding.accessConcerns.map(sanitizeAccessLanguage), ACCESS_UNRESOLVED_NOTE])];
  return {
    ...finding,
    adjoiningRoads: roads,
    legalAccessStatus: finding.legalAccessStatus === 'confirmed' ? 'confirmed' : 'unconfirmed',
    measurementMethod: 'Road-centerline length within a 25 m buffer of the mapped parcel boundary (proximity screening — not a frontage measurement).',
    accessConcerns: concerns,
    summary: proximityParts.length
      ? `Road proximity screening: ${proximityParts.join('; ')}. ${ACCESS_UNRESOLVED_NOTE}`
      : sanitizeAccessLanguage(finding.summary),
    whyItMatters: 'Road proximity shows which roads could plausibly serve the parcel — it does not establish contact, frontage, or any form of access.',
    limitation: 'Centerline proximity is approximate GIS screening. It is not surveyed frontage, not proof of parcel–road contact, and not proof of physical or legal access; recorded instruments and a survey control.',
  };
}

function sanitizeSlopeFinding(finding: SlopeFinding): SlopeFinding {
  // Band acreage derived from point samples is removed — the honest statement
  // is which bands the sampled points fell into, never parcel-wide acreage.
  const sampledBands = finding.bands.filter((band) => band.parcelPercentage > 0);
  const bandLabel = (band: string) => band.replace('_to_', '% to ') + (band.startsWith('above') ? '%+' : '%');
  const pointStatement = sampledBands.length === 1
    ? `All sampled interior points fell within the ${bandLabel(sampledBands[0].band).replace('above_', 'above ')} slope range. Parcel-wide slope-band acreage has not been calculated from point samples.`
    : sampledBands.length > 1
      ? `Sampled interior points fell across ${sampledBands.map((band) => `${bandLabel(band.band)} (${band.parcelPercentage}% of samples)`).join(', ')}. Parcel-wide slope-band acreage has not been calculated from point samples.`
      : 'Parcel-wide slope-band acreage has not been calculated from point samples.';
  const stats = [
    finding.meanSlopePct != null ? `mean ${finding.meanSlopePct}%` : null,
    finding.medianSlopePct != null ? `median ${finding.medianSlopePct}%` : null,
    finding.maximumSlopePct != null ? `max ${finding.maximumSlopePct}%` : null,
    finding.totalReliefFt != null ? `relief ${finding.totalReliefFt} ft` : null,
  ].filter(Boolean).join(', ');
  return {
    ...finding,
    // Percent-of-samples is honest; acreage from samples is not.
    bands: finding.bands.map((band) => ({ ...band, approximateAcres: 0 })),
    largestApparentLowSlopeAreaAcres: undefined,
    summary: `Interior point-sample terrain screening${stats ? ` (${stats})` : ''}. ${pointStatement}`,
    limitation: 'Slope statistics come from interior point samples, not a full-parcel DEM distribution or survey. They never produce slope-band acreage.',
  };
}

// ── Visual-conclusion safety ──────────────────────────────────────────────────
// Imagery shows features near a location; it never proves parcel attribution,
// service, or access. Every unsafe visual claim maps to its safe form, and an
// observation carries three separate confidences: feature detection, parcel
// attribution, underwriting significance.

const VISUAL_REWRITES: Array<{ re: RegExp; safe: string }> = [
  { re: /(parcel|property|lot)\s+fronts\s+(a\s+)?paved\s+road/i, safe: 'Paved road visible nearby; direct parcel–road contact unresolved' },
  { re: /power\s*lines?\s+(run|running)\s+along\s+the\s+(property\s+)?(frontage|road proximity|boundary)/i, safe: 'Overhead lines visible near the roadway; parcel service unconfirmed' },
  { re: /power\s*lines?[^.]*serv(?:e|ing)\s+the\s+(parcel|property)/i, safe: 'Overhead lines visible near the roadway; parcel service unconfirmed' },
  { re: /(lot|parcel|property)\s+is\s+(partially\s+)?cleared/i, safe: 'Clearing visible nearby; parcel attribution unresolved' },
  { re: /structure\s+(is\s+)?(on|located on)\s+the\s+(parcel|property|lot)/i, safe: 'Structure visible nearby; parcel attribution unresolved' },
  { re: /excellent\s+(paved\s+)?access/i, safe: 'Paved road visible nearby; legal and physical access unresolved' },
  { re: /existing\s+utility\s+(infrastructure|hookups?)/i, safe: 'Utility features visible near the roadway; parcel service unconfirmed' },
  { re: /ready\s+(for|to)\s+(use|build)/i, safe: 'Apparent site conditions only; readiness unresolved pending access, septic, and flood confirmation' },
];

export interface VisualConfidenceTriple {
  featureDetection: 'high' | 'medium' | 'low';
  parcelAttribution: 'high' | 'medium' | 'low' | 'unresolved';
  underwritingSignificance: 'high' | 'medium' | 'low' | 'unresolved';
}

/** Rewrite an unsafe visual claim into its safe, attribution-honest form. */
export function sanitizeVisualConclusion(text: string): { text: string; rewritten: boolean } {
  for (const { re, safe } of VISUAL_REWRITES) {
    if (re.test(text)) return { text: text.replace(re, safe), rewritten: true };
  }
  return { text: sanitizeAccessLanguage(text), rewritten: false };
}

/**
 * Sanitize a visual observation (label + detail) and attach the three-part
 * confidence. Detection confidence is preserved from the analyzer; parcel
 * attribution is UNRESOLVED unless the observation's evidence proves an
 * association (parcel overlay / verified coordinates).
 */
export function sanitizeVisualObservation<T extends { label: string; detail: string; confidence?: string; evidence?: string }>(obs: T): T & { confidences: VisualConfidenceTriple } {
  const label = sanitizeVisualConclusion(obs.label);
  const detail = sanitizeVisualConclusion(obs.detail);
  const associationProven = /parcel overlay|boundary overlay|verified coordinates|official aerial/i.test(obs.evidence ?? '');
  const det = (obs.confidence ?? 'medium').toLowerCase();
  return {
    ...obs,
    label: label.text,
    detail: detail.text,
    confidences: {
      featureDetection: det === 'high' ? 'high' : det === 'low' ? 'low' : 'medium',
      parcelAttribution: associationProven ? 'medium' : 'unresolved',
      underwritingSignificance: label.rewritten || detail.rewritten || !associationProven ? 'unresolved' : 'medium',
    },
  };
}

/**
 * Sanitize a persisted public-intelligence run so no tab can render unsafe
 * frontage or slope-acreage conclusions from historical provider output.
 * Structure, provenance, and every other finding are preserved verbatim.
 */
export function sanitizePublicIntelligenceRun<T extends PublicIntelligenceRun>(run: T): T {
  const tasks = (run.tasks ?? []).map((task) => {
    if (!task?.finding) return task;
    if (task.finding.kind === 'road_frontage') return { ...task, finding: sanitizeFrontageFinding(task.finding as FrontageFinding) };
    if (task.finding.kind === 'slope_topography') return { ...task, finding: sanitizeSlopeFinding(task.finding as SlopeFinding) };
    return task;
  });
  return { ...run, tasks };
}
