import type { BrowserEvidence, BrowserFact, BrowserSearchKey, BrowserSearchMode, BrowserService, BrowserWorkflowInput } from './browser-intelligence.js';
import {
  type PendingPropertyInspectionRecord,
  type PropertyInspectionEvidence,
  type PropertyInspectionSource,
  type LandPortalComparableRecord,
  savePropertyInspection,
} from './property-card.js';
import { captureAndPersistCardVisuals, type CaptureWorkflowResult } from './visual-capture-workflow.js';
import { resolveGoogleVisualEnv } from './providers/google-visual.js';
import { evaluateThreeDCaptureEligibility } from './landportal-operating-rules.js';

export interface PropertyInspectionRoute {
  provider: string;
  stage: string;
  status: PropertyInspectionSource['status'];
  confidence: PropertyInspectionSource['confidence'];
  url?: string | null;
  note: string;
}

export interface PropertyInspectionResult {
  inspection: PendingPropertyInspectionRecord;
  routes: PropertyInspectionRoute[];
}

export interface PropertyInspectionDeps {
  landPortalBrowser?: BrowserService;
  countyRecordsBrowser?: BrowserService;
  googleVisualConfigured?: boolean;
  captureVisuals?: (cardId: number) => Promise<CaptureWorkflowResult>;
  /** Monotonic clock seam used to keep all browser providers inside one
   * inspection deadline. Tests inject it; production uses Date.now(). */
  nowMs?: () => number;
}

export interface PropertyInspectionInput {
  cardId?: number;
  searchKey: BrowserSearchKey;
  mode?: BrowserSearchMode;
  existingEvidence?: BrowserEvidence[];
  timeoutMs: number;
  /** Fired as soon as the verified LandPortal parcel's own facts are read,
   *  ahead of this inspection's imagery and county deep-record work. The
   *  inspection itself is unchanged: it still runs to completion and still
   *  returns the same result. */
  onLandPortalSubjectFacts?: (payload: { url: string; fields: Record<string, string> }) => void;
}

const ROUTE_ORDER = [
  'LandPortal',
  'Realie',
  'County Records Browser',
  'NETR',
  'Official County GIS',
  'Official Assessor',
  'Official Tax Office',
  'Official Recorder',
  'Google Maps / Satellite / Street View',
] as const;

function emptyInspection(): PendingPropertyInspectionRecord {
  return {
    parcelUrl: null,
    comparablesUrl: null,
    parcelFacts: {},
    assets: [],
    overlays: [],
    visualObservations: [],
    comparables: [],
    sources: [],
    evidence: [],
    discoveryQuestions: [],
    missingInformation: [],
  };
}

function routeTemplate(provider: (typeof ROUTE_ORDER)[number], note: string, status: PropertyInspectionRoute['status'] = 'not_attempted', confidence: PropertyInspectionRoute['confidence'] = 'low', url?: string | null): PropertyInspectionRoute {
  return { provider, stage: provider.toLowerCase().replace(/[^a-z0-9]+/g, '_'), status, confidence, url, note };
}

function indexRoutes(routes: PropertyInspectionRoute[]): Record<string, number> {
  return Object.fromEntries(routes.map((r, i) => [r.provider, i]));
}

function upsertRoute(routes: PropertyInspectionRoute[], provider: string, patch: Partial<PropertyInspectionRoute>): void {
  const idx = routes.findIndex((r) => r.provider === provider);
  if (idx >= 0) routes[idx] = { ...routes[idx], ...patch };
  else routes.push(routeTemplate(provider as never, patch.note ?? '', patch.status ?? 'partial', patch.confidence ?? 'low', patch.url));
}

function browserEvidenceByService(existing: BrowserEvidence[] | undefined, service: string): BrowserEvidence | undefined {
  return (existing ?? []).find((e) => e.service === service);
}

function countyFactMap(facts: BrowserFact[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const fact of facts) {
    if (fact.status !== 'extracted') continue;
    if (!map[fact.label]) map[fact.label] = fact.value;
  }
  return map;
}

/**
 * A LandPortal read can establish jurisdiction even when the original operator
 * title did not contain a county.  County research must use that just-observed
 * parcel locality rather than failing before it can reach the official record
 * systems.  Placeholder values are deliberately not promoted into a route key.
 */
function inspectionFact(facts: Record<string, string>, names: string[]): string | undefined {
  for (const name of names) {
    const value = facts[name]?.trim();
    if (value && !/^(?:-|--|n\/?a|not\s+(?:available|found)|unknown)$/i.test(value)) return value;
  }
  return undefined;
}

function countySearchKey(input: BrowserSearchKey, facts: Record<string, string>): BrowserSearchKey {
  return {
    ...input,
    county: input.county ?? inspectionFact(facts, ['Parcel Address County', 'County']),
    state: input.state ?? inspectionFact(facts, ['Parcel Address State', 'State', 'Situs State']),
    city: input.city ?? inspectionFact(facts, ['Parcel Address City', 'City', 'Situs City']),
    apn: input.apn ?? inspectionFact(facts, ['Parcel ID', 'APN', 'Parcel Number']),
    address: input.address ?? inspectionFact(facts, ['Parcel Address', 'Situs Address', 'Property Address']),
  };
}

function mergeFacts(base: Record<string, string>, incoming: Record<string, string>): Record<string, string> {
  const out = { ...base };
  for (const [k, v] of Object.entries(incoming)) if (!out[k] && v) out[k] = v;
  return out;
}

function factNumber(facts: Record<string, string>, names: string[]): number | null {
  const value = inspectionFact(facts, names);
  if (!value) return null;
  const match = value.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  const parsed = match ? Number(match[0]) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * A quarantined provider value keeps its observation under `<field> (provider
 * observation)` while the field itself is emptied. Every decision reader looks
 * the field up by its exact name, so the companion key can never be mistaken
 * for a usable figure — and the operator surfaces can still state what the
 * provider actually said, with the reason it is not being relied on.
 */
/**
 * Time held back from the parcel read for the official county-records lane, so
 * the assessor / recorder / collecting-office pass is never starved by it.
 */
export const OFFICIAL_RECORDS_RESERVE_MS = 45_000;

export const QUARANTINE_OBSERVATION_SUFFIX = ' (provider observation)';
const QUARANTINE_OBSERVATION_SUFFIX_RE = /\(provider observation\)$/i;
export const TERRAIN_QUARANTINE_REASON_FACT = 'Terrain Quarantine Reason';
/** Empty, not prose: a sentence in a value slot renders as if it were a value. */
const TERRAIN_QUARANTINE_PLACEHOLDER = '';

/**
 * Every acreage the retained parcel record states for THIS parcel, strongest
 * basis first. A provider's derived model (buildable area, coverage overlays)
 * may be computed against any of them.
 */
export function acreageBasesFor(facts: Record<string, string>): Array<{ label: string; acres: number }> {
  const bases: Array<{ label: string; acres: number }> = [];
  const add = (label: string, value: number | null): void => {
    if (value == null || !Number.isFinite(value) || value <= 0) return;
    if (bases.some((basis) => Math.abs(basis.acres - value) < 0.01)) return;
    bases.push({ label, acres: value });
  };
  add('assessed acreage', factNumber(facts, ['Acres']));
  add('provider calculated acreage', factNumber(facts, ['Calc Acres']));
  add('MLS acreage', factNumber(facts, ['MLS Acres']));
  const sqft = factNumber(facts, ['Parcel SqFt']);
  add('parcel square footage', sqft != null && sqft > 0 ? Math.round((sqft / 43_560) * 100) / 100 : null);
  return bases;
}

/**
 * LandPortal terrain/buildability values are provider-model outputs, not
 * surveyed facts. The previous path promoted every numeric provider field as
 * high-confidence evidence and downstream scoring consumed it verbatim even
 * when no analyst had interpreted the terrain image. Likewise, a frontage
 * number could survive despite imagery showing a materially narrower road
 * neck. Quarantine only the challenged numeric fields while retaining the raw
 * values in evidence for targeted follow-up.
 */
function challengeImplausibleVisualFacts(inspection: PendingPropertyInspectionRecord): PendingPropertyInspectionRecord {
  const out: PendingPropertyInspectionRecord = {
    ...inspection,
    parcelFacts: { ...inspection.parcelFacts },
    evidence: [...(inspection.evidence ?? [])],
    visualObservations: [...inspection.visualObservations],
  };
  const facts = out.parcelFacts;
  const addChallenge = (label: string, detail: string): void => {
    out.evidence!.push({
      label,
      status: 'needs_verification',
      detail,
      confidence: 'low',
      source: 'Multimodal parcel review',
      url: inspection.parcelUrl,
    });
  };

  const frontage = factNumber(facts, ['Road Frontage', 'Road Frontage Ft']);
  const visualFrontageMatch = out.visualObservations
    // A generated "Parcel panel: Road Frontage = …" observation is only the
    // provider number repeated in prose, not independent image interpretation.
    .filter((row) => /imagery|aerial|boundary|map|visual/i.test(`${row.detail} ${row.evidence}`))
    .map((row) => `${row.label} ${row.detail}`)
    .map((text) => /(?:frontage|road (?:neck|contact))[^.\d]{0,45}(?:approx(?:imately)?\.?\s*)?(\d[\d,.]*)\s*(?:ft|feet)/i.exec(text)
      ?? /(?:approx(?:imately)?\.?\s*)?(\d[\d,.]*)\s*(?:ft|feet)[^.]{0,45}(?:frontage|road (?:neck|contact))/i.exec(text))
    .find((match): match is RegExpExecArray => !!match) ?? null;
  const visualFrontage = visualFrontageMatch ? Number(visualFrontageMatch[1].replace(/,/g, '')) : null;
  if (frontage != null && visualFrontage != null && visualFrontage > 0
      && Math.abs(frontage - visualFrontage) >= 150
      && Math.max(frontage, visualFrontage) / Math.min(frontage, visualFrontage) >= 3) {
    const raw = facts['Road Frontage'] ?? facts['Road Frontage Ft'] ?? `${frontage} ft`;
    for (const key of ['Road Frontage', 'Road Frontage Ft']) {
      if (key in facts) facts[key] = 'Needs visual verification — imagery indicates materially different parcel-road contact.';
    }
    addChallenge('Road frontage conflict', `Provider frontage (${raw}) conflicts with the imagery observation (${visualFrontageMatch![0].trim()}); the numeric frontage is withheld from scoring and strategy until targeted access research resolves it.`);
  }

  // A provider states more than one acreage for the same parcel: the assessed
  // `Acres`, its own geometry-derived `Calc Acres`, and an MLS figure. Its
  // terrain model runs over ONE of them, and it is not always the assessed one.
  // Reconciling the buildable area against a single basis therefore rejects
  // correct terrain output whenever the model used a different denominator —
  // which is how a parcel whose buildable area reconciles exactly against the
  // provider's own calculated acreage was quarantined against the assessed one.
  const acreageBases = acreageBasesFor(facts);
  const acres = acreageBases[0]?.acres ?? null;
  const slope = factNumber(facts, ['Slope Avg', 'Average Slope']);
  const slopeMax = factNumber(facts, ['Slope Max']);
  const buildability = factNumber(facts, ['Buildability total (%)', 'Buildability total', 'Buildability']);
  const buildableAcres = factNumber(facts, ['Buildability area (acres)', 'Buildability area']);
  const terrainContradictsExtreme = out.visualObservations.some((row) =>
    row.confidence !== 'low'
    && /terrain|slope|contour|ridge|grade|topograph|buildab/i.test(`${row.label} ${row.detail} ${row.evidence}`)
    && /flat|gentle|rolling|moderate|mostly level|usable bench/i.test(`${row.label} ${row.detail} ${row.evidence}`));
  const terrainCorroboratesExtreme = !terrainContradictsExtreme && out.visualObservations.some((row) =>
    row.confidence !== 'low'
    && /terrain|slope|contour|ridge|grade|topograph|buildab/i.test(`${row.label} ${row.detail} ${row.evidence}`)
    && /steep|very steep|extreme|mountain|strong relief|heavy grade/i.test(`${row.label} ${row.detail} ${row.evidence}`)
    && !/not\s+(?:uniformly\s+)?(?:steep|extreme)|rather than[^.]{0,30}(?:steep|extreme)/i.test(`${row.label} ${row.detail} ${row.evidence}`));
  // Reconciled against ANY retained acreage basis. The arithmetic is only in
  // conflict when NO basis the provider itself published explains the stated
  // buildable percentage.
  const reconcilingBasis = buildability != null && buildableAcres != null
    ? acreageBases.find((basis) => basis.acres > 0
      && Math.abs((buildableAcres / basis.acres) * 100 - buildability) <= Math.max(1, buildability * 0.2)) ?? null
    : null;
  const arithmeticConflict = acres != null && acres > 0 && buildability != null && buildableAcres != null
    && !reconcilingBasis;
  const extremeUncorroborated = !terrainCorroboratesExtreme
    && ((slope != null && slope >= 35) || (buildability != null && buildability < 5));
  const invalidTerrain = (buildability != null && (buildability < 0 || buildability > 100))
    || (slope != null && slope < 0)
    || (slopeMax != null && slope != null && slopeMax < slope);
  if (arithmeticConflict || extremeUncorroborated || invalidTerrain) {
    const rawSummary = [
      slope != null ? `average slope ${slope}%` : null,
      buildability != null ? `buildability ${buildability}%` : null,
      buildableAcres != null ? `buildable area ${buildableAcres} acres` : null,
    ].filter(Boolean).join(', ');
    // Quarantine withholds a number from DECISIONS. It must not delete the
    // observation: the operator still needs to see what the provider actually
    // reported, and a research lane still needs it to know what to reconcile
    // against. The decision slot is emptied (no reader can parse a number out
    // of it) while the observed value is retained under its own companion key,
    // which no decision reader looks up.
    for (const key of Object.keys(facts)) {
      if (/^(?:Slope|Flat Slope|Minimal Slope|Moderate Slope|Heavy Slope|Extreme Slope|Buildability)/i.test(key)) {
        if (QUARANTINE_OBSERVATION_SUFFIX_RE.test(key)) continue;
        const observed = facts[key];
        if (observed && !/^(?:-|--|n\/?a)$/i.test(observed.trim())) {
          facts[`${key}${QUARANTINE_OBSERVATION_SUFFIX}`] = observed;
        }
        facts[key] = TERRAIN_QUARANTINE_PLACEHOLDER;
      }
    }
    const reason = arithmeticConflict
      ? 'the buildable-area arithmetic does not reconcile to parcel acreage'
      : invalidTerrain
        ? 'the provider terrain values fail range or ordering checks'
        : terrainContradictsExtreme
          ? 'the retained imagery interpretation describes materially gentler terrain'
          : 'the extreme provider values have no medium-confidence steep-terrain interpretation from the retained imagery';
    facts[TERRAIN_QUARANTINE_REASON_FACT] = `Provider reported ${rawSummary || 'terrain/buildability values'}, but ${reason}.`;
    addChallenge('Terrain and buildability conflict', `Provider reported ${rawSummary || 'terrain/buildability values'}, but ${reason}. These numeric fields are withheld from scoring, valuation, septic conclusions, strategy ranking, and offer guidance pending visual reconciliation or an independent terrain source.`);
  }
  return out;
}

function normalizeInspectionComparables(rows: LandPortalComparableRecord[]): LandPortalComparableRecord[] {
  const normalized: LandPortalComparableRecord[] = [];
  for (const row of rows ?? []) {
    const apn = (row.apn ?? '').trim() || null;
    const address = (row.address ?? '').trim() || null;
    const acres = typeof row.acres === 'number' && Number.isFinite(row.acres) && row.acres > 0 ? row.acres : null;
    const price = typeof row.price === 'number' && Number.isFinite(row.price) && row.price > 0 ? Math.round(row.price) : null;
    let pricePerAcre = typeof row.pricePerAcre === 'number' && Number.isFinite(row.pricePerAcre) && row.pricePerAcre > 0 ? Math.round(row.pricePerAcre) : null;
    if (pricePerAcre == null && price != null && acres != null) pricePerAcre = Math.round(price / acres);
    if (pricePerAcre != null && price != null && acres != null) {
      const computed = price / acres;
      if (computed > 0 && Math.abs(pricePerAcre - computed) / computed > 0.2) pricePerAcre = Math.round(computed);
    }
    if (price == null && acres == null && pricePerAcre == null && !row.saleDate) continue;
    const raw = (row.rawText ?? '').replace(/\s+/g, ' ').trim();
    normalized.push({
      ...row,
      rawText: raw,
      apn,
      address,
      acres,
      price,
      pricePerAcre,
      confidence: pricePerAcre != null && row.status !== 'unknown' ? row.confidence : 'low',
    });
  }
  const grouped = new Map<string, LandPortalComparableRecord>();
  const score = (row: LandPortalComparableRecord): number =>
    (row.apn ? 4 : 0)
    + (row.address ? 3 : 0)
    + (row.acres ? 2 : 0)
    + (row.price ? 2 : 0)
    + (row.pricePerAcre ? 2 : 0)
    + (row.status !== 'unknown' ? 1 : 0);
  for (const row of normalized) {
    // Group on the APN's DIGITS so the same parcel written "115 02100" on one
    // surface and "11502100" on another is one row, never two. A street address
    // is the next strongest key — the Show-on-Map surface supplies addresses
    // where the sidebar does not.
    const apnDigits = (row.apn ?? '').replace(/[^0-9a-z]/gi, '').toLowerCase();
    const addressKey = (row.address ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    const key = apnDigits.length >= 5
      ? `apn|${apnDigits}`
      : addressKey.length >= 6
        ? `addr|${addressKey}`
        : [row.sourceUrl, row.status, row.saleDate ?? '', row.acres ?? '', row.price ?? '', row.pricePerAcre ?? ''].join('|');
    const existing = grouped.get(key);
    if (!existing || score(row) > score(existing)) grouped.set(key, row);
  }
  return [...grouped.values()].filter((row) => {
    if (row.pricePerAcre != null) return true;
    if (row.apn && row.price != null && row.acres != null) return true;
    // An identifiable row (street address) with price and acreage is retained
    // even when LandPortal states no sale/list status. Dropping it would hide a
    // real candidate; the comp source policy holds it as context instead.
    if (row.address && row.price != null && row.acres != null) return true;
    return row.price != null && row.acres != null && row.status !== 'unknown';
  });
}

function evidenceFromInspection(inspection: PendingPropertyInspectionRecord): PropertyInspectionEvidence[] {
  // Preserve source-specific county evidence assembled from the live browser.
  // The previous implementation rebuilt this array from flattened parcel facts
  // and silently discarded the assessor/GIS/tax/recorder provenance.
  const evidence: PropertyInspectionEvidence[] = [...(inspection.evidence ?? [])];
  const pushUnique = (item: PropertyInspectionEvidence): void => {
    if (evidence.some((existing) =>
      existing.label === item.label
      && existing.detail === item.detail
      && (existing.url ?? null) === (item.url ?? null))) return;
    evidence.push(item);
  };
  const quarantineReason = inspection.parcelFacts[TERRAIN_QUARANTINE_REASON_FACT] ?? null;
  for (const [label, value] of Object.entries(inspection.parcelFacts)) {
    if (!value || /^not found$/i.test(value)) continue;
    if (label === TERRAIN_QUARANTINE_REASON_FACT) continue;
    // A retained observation behind a quarantine is EVIDENCE OF WHAT THE
    // PROVIDER SAID, never a verified parcel fact. It carries the quarantine
    // reason with it so nothing downstream can read it as a settled figure.
    const quarantinedObservation = QUARANTINE_OBSERVATION_SUFFIX_RE.test(label);
    const challenged = quarantinedObservation || /^needs visual verification\b/i.test(value);
    pushUnique({
      label,
      status: challenged ? 'needs_verification' : 'verified',
      detail: quarantinedObservation && quarantineReason
        ? `Provider reported ${value}. Held for visual verification: ${quarantineReason}`
        : value,
      confidence: challenged ? 'low' : 'high',
      source: (inspection.sources ?? []).find((s) => s.provider === 'LandPortal' || s.provider.startsWith('Official'))?.provider ?? null,
      url: inspection.parcelUrl,
    });
  }
  for (const obs of inspection.visualObservations) {
    pushUnique({
      label: obs.label,
      status: 'observed',
      detail: obs.detail,
      confidence: obs.confidence,
      source: 'Imagery observation',
      url: inspection.parcelUrl,
    });
  }
  for (const overlay of inspection.overlays) {
    pushUnique({
      label: overlay.overlay,
      status: overlay.status === 'captured' || overlay.status === 'observed' ? 'observed' : 'needs_verification',
      detail: overlay.note,
      confidence: overlay.confidence,
      source: 'Overlay inspection',
      url: inspection.parcelUrl,
    });
  }
  return evidence;
}

function missingInformation(inspection: PendingPropertyInspectionRecord): string[] {
  const missing: string[] = [];
  const fields = inspection.parcelFacts;
  const missingFact = (...keys: string[]) => keys.every((k) => !fields[k] || /^not found$/i.test(fields[k] ?? ''));
  if (missingFact('Owner Name', 'Owner')) missing.push('Owner');
  if (missingFact('Parcel ID', 'APN')) missing.push('APN / parcel ID');
  if (missingFact('Acres', 'Calc Acres')) missing.push('Acreage');
  if (!inspection.parcelUrl) missing.push('Parcel source URL');
  if (!inspection.assets.some((a) => a.kind === 'parcel_page')) missing.push('Parcel imagery screenshot');
  if (!inspection.assets.some((a) => a.kind === 'parcel_3d') && inspection.threeDCapture?.decision !== 'not_applicable') missing.push('3D terrain screenshot');
  if (!inspection.assets.some((a) => a.kind === 'comparables_map')) missing.push('Comparable map screenshot');
  if (inspection.comparables.length === 0) missing.push('Comparable rows');
  return missing;
}

function buildDiscoveryQuestions(inspection: PendingPropertyInspectionRecord): string[] {
  const questions: string[] = [];
  const facts = inspection.parcelFacts;
  const hasVisual = (rx: RegExp) => inspection.visualObservations.some((v) => rx.test(v.label) || rx.test(v.detail));
  const hasOverlay = (name: string) => inspection.overlays.some((o) => o.overlay.toLowerCase() === name.toLowerCase() && o.status !== 'not_found');
  if (!('Survey' in facts)) questions.push('Existing survey?');
  if (!('Utility Power' in facts) && !('Utilities' in facts)) questions.push('Utilities available?');
  if (!('Land Locked' in facts) || /yes/i.test(facts['Land Locked'] ?? '')) questions.push('Easements or access issues?');
  if (hasVisual(/water feature|pond|creek|stream/i)) questions.push('Pond year-round?');
  if (hasOverlay('Wetlands')) questions.push('Wetland delineation completed?');
  if (hasOverlay('Soil')) questions.push('Any perc or soil testing completed?');
  if (hasOverlay('Contours') || !('Road Frontage' in facts)) questions.push('Any terrain or frontage constraints to know about?');
  if (hasVisual(/existing improvement/i)) questions.push('What existing improvements are on site, and were they permitted?');
  return [...new Set(questions)].slice(0, 8);
}

function baseRoutes(): PropertyInspectionRoute[] {
  return [
    routeTemplate('LandPortal', 'Primary parcel inspection provider.'),
    routeTemplate('Realie', 'Structured provider fallback when enabled.', 'not_configured'),
    routeTemplate('County Records Browser', 'Browser fallback to official county systems.'),
    routeTemplate('NETR', 'Navigation layer to official county destinations.'),
    routeTemplate('Official County GIS', 'Official GIS parcel viewer destination.'),
    routeTemplate('Official Assessor', 'Official assessor / appraisal destination.'),
    routeTemplate('Official Tax Office', 'Official tax office destination.'),
    routeTemplate('Official Recorder', 'Official recorder / deed destination.'),
    routeTemplate('Google Maps / Satellite / Street View', 'Imagery fallback and supplemental visual context.', 'not_attempted'),
  ];
}

function packageFromLandPortal(ev: BrowserEvidence): PendingPropertyInspectionRecord | null {
  if (!ev.inspection) return null;
  return {
    ...ev.inspection,
    sources: [{
      provider: 'LandPortal',
      stage: 'landportal',
      status: ev.status === 'retrieved' ? 'used' : ev.status === 'partial' ? 'partial' : 'error',
      confidence: 'high',
      url: ev.inspection.parcelUrl,
      note: ev.note || 'LandPortal parcel inspection.',
    }],
    evidence: [...(ev.inspection.evidence ?? [])],
    discoveryQuestions: [],
    missingInformation: [],
  };
}

function packageFromCounty(ev: BrowserEvidence): PendingPropertyInspectionRecord {
  const parcelFacts = countyFactMap(ev.facts);
  const attemptSources: PropertyInspectionSource[] = (ev.sourceAttempts ?? []).map((attempt) => ({
    provider: attempt.sourceName,
    stage: `county_${attempt.sourceType.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
    status: attempt.result === 'retrieved'
      ? 'used'
      : attempt.result === 'useful_indication'
        ? 'fallback'
        : attempt.result === 'execution_failure' || attempt.result === 'source_unavailable'
          ? 'error'
          : 'partial',
    resultKind: attempt.result,
    attemptedAt: attempt.attemptedAt,
    confidence: attempt.result === 'retrieved' ? 'high' : attempt.result === 'useful_indication' ? 'medium' : 'low',
    url: attempt.sourceUrl,
    note: attempt.note,
  }));
  const fallbackSource: PropertyInspectionSource = {
    provider: 'County Records Browser',
    stage: 'county_records_browser',
    status: ev.status === 'retrieved' ? 'fallback' : ev.status === 'partial' ? 'partial' : 'error',
    resultKind: ev.status === 'retrieved'
      ? 'retrieved'
      : ev.status === 'no_match'
        ? 'not_found'
        : ev.status === 'error'
          ? 'execution_failure'
          : 'attempted_inconclusive',
    attemptedAt: null,
    confidence: ev.status === 'retrieved' ? 'medium' : 'low',
    url: ev.sourcesUsed[0]?.url ?? null,
    note: ev.note || 'County records fallback inspection.',
  };
  const countyEvidence: PropertyInspectionEvidence[] = ev.facts
    .filter((fact) => fact.status === 'extracted')
    .map((fact) => ({
      label: fact.label,
      status: /link$/i.test(fact.key) ? 'observed' : 'verified',
      detail: fact.value,
      confidence: fact.confidence,
      source: fact.sourceName,
      url: fact.sourceUrl,
    }));
  return {
    parcelUrl: ev.sourcesUsed[0]?.url ?? ev.sourceUrls[0] ?? null,
    comparablesUrl: null,
    parcelFacts,
    assets: [],
    overlays: [],
    visualObservations: [],
    comparables: [],
    sources: attemptSources.length ? attemptSources : [fallbackSource],
    evidence: countyEvidence,
    discoveryQuestions: [],
    missingInformation: [],
  };
}

function mergeCountyRoutes(routes: PropertyInspectionRoute[], ev: BrowserEvidence): void {
  upsertRoute(routes, 'County Records Browser', {
    status: ev.status === 'retrieved' ? 'fallback' : ev.status === 'partial' ? 'partial' : 'error',
    confidence: ev.status === 'retrieved' ? 'medium' : 'low',
    note: ev.note || 'County records fallback run.',
    url: ev.sourcesUsed[0]?.url,
  });
  const types = new Set((ev.sourcesUsed ?? []).map((s) => s.type));
  upsertRoute(routes, 'NETR', {
    status: (ev.sourcesUsed ?? []).some((s) => s.origin === 'netr_county') ? 'used' : 'not_attempted',
    confidence: (ev.sourcesUsed ?? []).some((s) => s.origin === 'netr_county') ? 'medium' : 'low',
    note: (ev.sourcesUsed ?? []).some((s) => s.origin === 'netr_county') ? 'NETR used as navigation to official county systems.' : 'NETR not needed or not reached.',
  });
  if (types.has('gis')) upsertRoute(routes, 'Official County GIS', { status: 'used', confidence: 'medium', note: 'Official GIS source reached.' });
  if (types.has('assessor')) upsertRoute(routes, 'Official Assessor', { status: 'used', confidence: 'high', note: 'Official assessor/appraisal source reached.' });
  if (types.has('tax')) upsertRoute(routes, 'Official Tax Office', { status: 'used', confidence: 'high', note: 'Official tax office source reached.' });
  if (types.has('recorder')) upsertRoute(routes, 'Official Recorder', { status: 'used', confidence: 'high', note: 'Official recorder/deed source reached.' });
}

export async function runPropertyInspection(input: PropertyInspectionInput, deps: PropertyInspectionDeps): Promise<PropertyInspectionResult> {
  const routes = baseRoutes();
  let inspection = emptyInspection();
  let landPortalEvidence = browserEvidenceByService(input.existingEvidence, 'landportal');
  let countyEvidence = browserEvidenceByService(input.existingEvidence, 'county_records');
  // `timeoutMs` is the budget for the whole inspection, not a fresh allowance
  // for every sequential provider. The former per-provider interpretation let
  // a 180-second LandPortal pass plus a second 180-second county pass overrun
  // the 300-second parent identity mission before its official lookup ran.
  const nowMs = deps.nowMs ?? Date.now;
  const deadlineMs = nowMs() + Math.max(1, input.timeoutMs);
  const remainingMs = (): number => Math.max(0, deadlineMs - nowMs());
  // ── The official-records lane gets a reserved floor ───────────────────────
  //
  // LandPortal ran first and was handed the ENTIRE remaining budget, so on a
  // normal lead it consumed all of it and the official county lane was recorded
  // as "queued for the next run" — every run. That lane is the only one that
  // reaches the assessor, the recorder and the collecting office, so the
  // questions only they can answer (payment status above all) came back
  // unanswered not because a source refused, but because nothing was left to
  // ask with. The reserve is withheld from LandPortal ONLY when that lane is
  // actually going to run, and never takes more than a third of the budget, so
  // a tight deadline cannot starve the parcel read instead.
  const officialRecordsLaneExpected = input.mode === 'deep_record' && !!deps.countyRecordsBrowser?.configured() && countyEvidence == null;
  const officialRecordsReserveMs = officialRecordsLaneExpected
    ? Math.min(OFFICIAL_RECORDS_RESERVE_MS, Math.floor(Math.max(1, input.timeoutMs) / 3))
    : 0;
  /** What LandPortal may use: the remaining budget less the reserved floor. */
  const landPortalBudgetMs = (): number => Math.max(1, remainingMs() - officialRecordsReserveMs);

  if (landPortalEvidence?.inspection) {
    const lp = packageFromLandPortal(landPortalEvidence);
    if (lp) inspection = lp;
    upsertRoute(routes, 'LandPortal', { status: 'used', confidence: 'high', note: landPortalEvidence.note || 'LandPortal inspection reused from browser evidence.', url: inspection.parcelUrl });
  } else if (deps.landPortalBrowser?.configured()) {
    landPortalEvidence = await deps.landPortalBrowser.runWorkflow(
      { searchKey: input.searchKey, mode: input.mode, propertyCardId: input.cardId } satisfies BrowserWorkflowInput,
      { timeoutMs: landPortalBudgetMs(), onSubjectFacts: input.onLandPortalSubjectFacts },
    );
    if (landPortalEvidence.inspection) {
      const lp = packageFromLandPortal(landPortalEvidence);
      if (lp) inspection = lp;
      upsertRoute(routes, 'LandPortal', { status: landPortalEvidence.status === 'retrieved' ? 'used' : 'partial', confidence: 'high', note: landPortalEvidence.note || 'LandPortal inspection captured.', url: inspection.parcelUrl });
    } else {
      upsertRoute(routes, 'LandPortal', { status: landPortalEvidence.status === 'error' ? 'error' : 'partial', confidence: 'low', note: landPortalEvidence.note || 'LandPortal did not return an inspection package.' });
    }
  } else {
    upsertRoute(routes, 'LandPortal', { status: 'not_configured', confidence: 'low', note: 'LandPortal browser not configured.' });
  }

  const hasCoreParcelFacts = !!(inspection.parcelFacts['Owner Name'] || inspection.parcelFacts.Owner) && !!(inspection.parcelFacts['Parcel ID'] || inspection.parcelFacts.APN) && !!(inspection.parcelFacts.Acres || inspection.parcelFacts['Calc Acres']);
  // A deep-record mission is not a parcel-identity shortcut.  Even after
  // LandPortal identifies the parcel, it must continue to the public county
  // record lanes for GIS/assessor/recorder evidence (including a deed attempt).
  // The old core-facts gate silently skipped every one of those required paths.
  const needsCountyDeepRecord = input.mode === 'deep_record';
  const countyNeeded = needsCountyDeepRecord || !hasCoreParcelFacts || !inspection.parcelUrl;
  if (countyNeeded && countyEvidence == null && deps.countyRecordsBrowser?.configured() && remainingMs() > 0) {
    // Preserve explicit operator constraints, but let the immediately preceding
    // LandPortal parcel read supply missing county/state routing context.
    countyEvidence = await deps.countyRecordsBrowser.runWorkflow(
      { searchKey: countySearchKey(input.searchKey, inspection.parcelFacts), mode: input.mode },
      { timeoutMs: Math.max(1, remainingMs()) },
    );
  } else if (countyNeeded && countyEvidence == null && deps.countyRecordsBrowser?.configured()) {
    upsertRoute(routes, 'County Records Browser', {
      status: 'partial',
      confidence: 'low',
      note: 'The shared inspection deadline was exhausted after LandPortal; the official county lane remains queued for the next run.',
    });
  }
  if ((needsCountyDeepRecord || !hasCoreParcelFacts || !inspection.parcelUrl) && countyEvidence) {
    mergeCountyRoutes(routes, countyEvidence);
    const countyPkg = packageFromCounty(countyEvidence);
    inspection.parcelUrl ??= countyPkg.parcelUrl;
    inspection.parcelFacts = mergeFacts(inspection.parcelFacts, countyPkg.parcelFacts);
    inspection.sources = [...(inspection.sources ?? []), ...(countyPkg.sources ?? [])];
    inspection.evidence = [...(inspection.evidence ?? []), ...(countyPkg.evidence ?? [])];
  }

  if (input.cardId && deps.googleVisualConfigured && remainingMs() > 0) {
    // Resolve the Google key from the .env FILE (not just process.env) so the
    // Static Map + Street View capture actually fires — the key lives in the file,
    // which is why googleVisualConfiguredResolved() sees it but a bare process.env
    // read did not (the capture was silently returning "not configured").
    const capture = await (deps.captureVisuals ?? ((cardId: number) => captureAndPersistCardVisuals(cardId, {
      env: resolveGoogleVisualEnv(),
      timeoutMs: Math.max(1, remainingMs()),
    })))(input.cardId);
    upsertRoute(routes, 'Google Maps / Satellite / Street View', {
      status: capture.ok ? 'fallback' : 'partial',
      confidence: capture.ok ? 'medium' : 'low',
      note: capture.reason,
    });
  } else if (!deps.googleVisualConfigured) {
    upsertRoute(routes, 'Google Maps / Satellite / Street View', { status: 'not_configured', confidence: 'low', note: 'Google visual provider not configured.' });
  } else if (input.cardId) {
    upsertRoute(routes, 'Google Maps / Satellite / Street View', {
      status: 'partial',
      confidence: 'low',
      note: 'The shared inspection deadline was exhausted before Google imagery; use the card visual-capture action to retry without delaying parcel identity.',
    });
  }

  inspection = challengeImplausibleVisualFacts(inspection);
  inspection.threeDCapture ??= evaluateThreeDCaptureEligibility(inspection.parcelFacts);
  inspection.comparables = normalizeInspectionComparables(inspection.comparables);
  const hasDetailedCountySources = (inspection.sources ?? []).some((source) =>
    source.stage.startsWith('county_') && source.stage !== 'county_records_browser');
  inspection.sources = [...(inspection.sources ?? []), ...routes
    .filter((route) => !(route.provider === 'County Records Browser' && hasDetailedCountySources))
    .filter((r) => !(inspection.sources ?? []).some((s) => s.provider === r.provider))
    .map((r) => ({ provider: r.provider, stage: r.stage, status: r.status, confidence: r.confidence, url: r.url, note: r.note }))];
  inspection.missingInformation = missingInformation(inspection);
  inspection.evidence = evidenceFromInspection(inspection);
  inspection.discoveryQuestions = buildDiscoveryQuestions(inspection);
  return { inspection, routes };
}

export function persistPropertyInspection(cardId: number, inspection: PendingPropertyInspectionRecord): void {
  savePropertyInspection(cardId, inspection);
}
