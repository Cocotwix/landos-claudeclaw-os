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
}

export interface PropertyInspectionInput {
  cardId?: number;
  searchKey: BrowserSearchKey;
  mode?: BrowserSearchMode;
  existingEvidence?: BrowserEvidence[];
  timeoutMs: number;
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
    const key = row.apn
      ? `apn|${row.apn}`
      : [row.sourceUrl, row.status, row.saleDate ?? '', row.acres ?? '', row.price ?? '', row.pricePerAcre ?? ''].join('|');
    const existing = grouped.get(key);
    if (!existing || score(row) > score(existing)) grouped.set(key, row);
  }
  return [...grouped.values()].filter((row) => {
    if (row.pricePerAcre != null) return true;
    if (row.apn && row.price != null && row.acres != null) return true;
    return row.price != null && row.acres != null && row.status !== 'unknown';
  });
}

function evidenceFromInspection(inspection: PendingPropertyInspectionRecord): PropertyInspectionEvidence[] {
  const evidence: PropertyInspectionEvidence[] = [];
  for (const [label, value] of Object.entries(inspection.parcelFacts)) {
    if (!value || /^not found$/i.test(value)) continue;
    evidence.push({
      label,
      status: 'verified',
      detail: value,
      confidence: 'high',
      source: (inspection.sources ?? []).find((s) => s.provider === 'LandPortal' || s.provider.startsWith('Official'))?.provider ?? null,
      url: inspection.parcelUrl,
    });
  }
  for (const obs of inspection.visualObservations) {
    evidence.push({
      label: obs.label,
      status: 'observed',
      detail: obs.detail,
      confidence: obs.confidence,
      source: 'Imagery observation',
      url: inspection.parcelUrl,
    });
  }
  for (const overlay of inspection.overlays) {
    evidence.push({
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
  if (!inspection.assets.some((a) => a.kind === 'parcel_3d')) missing.push('3D terrain screenshot');
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
    evidence: [],
    discoveryQuestions: [],
    missingInformation: [],
  };
}

function packageFromCounty(ev: BrowserEvidence): PendingPropertyInspectionRecord {
  const parcelFacts = countyFactMap(ev.facts);
  return {
    parcelUrl: ev.sourcesUsed[0]?.url ?? ev.sourceUrls[0] ?? null,
    comparablesUrl: null,
    parcelFacts,
    assets: [],
    overlays: [],
    visualObservations: [],
    comparables: [],
    sources: [{
      provider: 'County Records Browser',
      stage: 'county_records_browser',
      status: ev.status === 'retrieved' ? 'fallback' : ev.status === 'partial' ? 'partial' : 'error',
      confidence: ev.status === 'retrieved' ? 'medium' : 'low',
      url: ev.sourcesUsed[0]?.url ?? null,
      note: ev.note || 'County records fallback inspection.',
    }],
    evidence: [],
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

  if (landPortalEvidence?.inspection) {
    const lp = packageFromLandPortal(landPortalEvidence);
    if (lp) inspection = lp;
    upsertRoute(routes, 'LandPortal', { status: 'used', confidence: 'high', note: landPortalEvidence.note || 'LandPortal inspection reused from browser evidence.', url: inspection.parcelUrl });
  } else if (deps.landPortalBrowser?.configured()) {
    landPortalEvidence = await deps.landPortalBrowser.runWorkflow({ searchKey: input.searchKey, mode: input.mode } satisfies BrowserWorkflowInput, { timeoutMs: input.timeoutMs });
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
  if ((needsCountyDeepRecord || !hasCoreParcelFacts || !inspection.parcelUrl) && countyEvidence == null && deps.countyRecordsBrowser?.configured()) {
    // Preserve explicit operator constraints, but let the immediately preceding
    // LandPortal parcel read supply missing county/state routing context.
    countyEvidence = await deps.countyRecordsBrowser.runWorkflow({ searchKey: countySearchKey(input.searchKey, inspection.parcelFacts), mode: input.mode }, { timeoutMs: input.timeoutMs });
  }
  if ((needsCountyDeepRecord || !hasCoreParcelFacts || !inspection.parcelUrl) && countyEvidence) {
    mergeCountyRoutes(routes, countyEvidence);
    const countyPkg = packageFromCounty(countyEvidence);
    inspection.parcelUrl ??= countyPkg.parcelUrl;
    inspection.parcelFacts = mergeFacts(inspection.parcelFacts, countyPkg.parcelFacts);
    inspection.sources = [...(inspection.sources ?? []), ...(countyPkg.sources ?? [])];
  }

  if (input.cardId && deps.googleVisualConfigured) {
    // Resolve the Google key from the .env FILE (not just process.env) so the
    // Static Map + Street View capture actually fires — the key lives in the file,
    // which is why googleVisualConfiguredResolved() sees it but a bare process.env
    // read did not (the capture was silently returning "not configured").
    const capture = await (deps.captureVisuals ?? ((cardId: number) => captureAndPersistCardVisuals(cardId, { env: resolveGoogleVisualEnv() })))(input.cardId);
    upsertRoute(routes, 'Google Maps / Satellite / Street View', {
      status: capture.ok ? 'fallback' : 'partial',
      confidence: capture.ok ? 'medium' : 'low',
      note: capture.reason,
    });
  } else if (!deps.googleVisualConfigured) {
    upsertRoute(routes, 'Google Maps / Satellite / Street View', { status: 'not_configured', confidence: 'low', note: 'Google visual provider not configured.' });
  }

  inspection.comparables = normalizeInspectionComparables(inspection.comparables);
  inspection.sources = [...(inspection.sources ?? []), ...routes
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
