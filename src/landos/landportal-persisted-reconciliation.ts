// LandOS — promotion of completed staged LandPortal evidence into the canonical
// Deal Card stores. Staged runs are an evidence ledger, not a second read model:
// this bridge is deliberately the only path that promotes a completed package.

import { getLandosDb, type LandosEntity } from './db.js';
import { getDealCard } from './deal-card.js';
import { upsertCardFromDukeRun, saveLandPortalInspection, attachCardActivity, type PendingPropertyInspectionRecord } from './property-card.js';
import { loadStagedRun, type StageRecord } from './landportal-staged-pilot.js';
import { loadBrowserUseRun } from './landportal-browseruse.js';
import { upsertNormalizedComp } from './comps.js';
import { upsertDealCardDd } from './deal-card-dd.js';
import { writeParcelIdentity } from './parcel-identity.js';
import { synchronizePropertySummarySlice } from './property-summary-slice.js';
import { ingestMarketSnapshots } from './market-matrix-store.js';
import type { MarketMetrics, MarketSnapshotPayload } from './market-matrix.js';

export interface PersistedLandPortalReconcileResult {
  promoted: boolean;
  runId: string | null;
  reason: string;
  cardId: number | null;
  compCount: number;
  visualCount: number;
}

type Dict = Record<string, unknown>;
const text = (v: unknown): string => typeof v === 'string' ? v.trim() : '';
const number = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const match = text(v).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
};
const stage = (rows: StageRecord[], id: string) => rows.find((row) => row.stage === id && row.status === 'completed')?.data as Dict | undefined;
const value = (rows: Array<{ label?: unknown; value?: unknown }>, label: string): string =>
  text(rows.find((row) => text(row.label).toLowerCase() === label.toLowerCase())?.value);
const flattenFacts = (data: Dict | undefined): Array<{ label?: unknown; value?: unknown }> => {
  const sections = data?.sections;
  if (!sections || typeof sections !== 'object') return [];
  return Object.values(sections as Record<string, unknown>).flatMap((entry) => Array.isArray(entry) ? entry as Array<{ label?: unknown; value?: unknown }> : []);
};
const isoDate = (value: unknown): string => {
  const raw = text(value);
  const match = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  return match ? `${match[3]}-${match[1]}-${match[2]}` : raw;
};
const quarter = (iso: string): string => {
  const date = new Date(iso);
  const year = Number.isFinite(date.getTime()) ? date.getUTCFullYear() : new Date().getUTCFullYear();
  const month = Number.isFinite(date.getTime()) ? date.getUTCMonth() : new Date().getUTCMonth();
  return `${year}-Q${Math.floor(month / 3) + 1}`;
};
const metricsFromMr = (raw: unknown): Partial<MarketMetrics> => {
  if (!raw || typeof raw !== 'object') return {};
  const aliases: Record<string, keyof MarketMetrics> = {
    Count: 'salesCount', DOM: 'daysOnMarket', STR: 'sellThroughRate', AR: 'absorptionRate', MoS: 'monthsOfSupply',
    Population: 'population', Density: 'populationDensity', Growth: 'populationGrowth', MP: 'medianPrice', PPA: 'medianPricePerAcre',
  };
  const out: Partial<MarketMetrics> = {};
  for (const [key, target] of Object.entries(aliases)) {
    const candidate = (raw as Dict)[key] ?? (raw as Dict)[target];
    const parsed = number(candidate);
    if (parsed != null) out[target] = parsed;
  }
  return out;
};
const captureFile = (value: string): boolean => /^browseruse_[a-z0-9_]{1,60}-\d{10,16}\.png$/i.test(value);

/** Every retained staged capture is promoted through the regular inspection
 * registry.  The staged payload has evolved over time, so walk its objects
 * rather than binding this durable bridge to one screen-specific shape. */
function retainedImages(stages: StageRecord[]): Array<{ key: string; label: string; file: string; overlay?: string }> {
  const found = new Map<string, { key: string; label: string; file: string; overlay?: string }>();
  const visit = (node: unknown, hint = ''): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach((item) => visit(item, hint)); return; }
    const row = node as Dict;
    const file = text(row.file) || text(row.thumbnailFile) || text(row.compShot) || text(row.screenshotFile);
    if (captureFile(file)) {
      const label = text(row.label) || text(row.title) || hint || file.replace(/^browseruse_|-\d+\.png$/g, '');
      found.set(file, { key: label.toLowerCase().replace(/[^a-z0-9]+/g, '_') || file, label, file, overlay: text(row.overlay) || undefined });
    }
    for (const [key, value] of Object.entries(row)) visit(value, key);
  };
  for (const current of stages) visit(current.data, current.stage);
  return [...found.values()].sort((a, b) => Number(!/road.*frontage.*aerial/i.test(a.label)) - Number(!/road.*frontage.*aerial/i.test(b.label)));
}

function subjectCard(deal: NonNullable<ReturnType<typeof getDealCard>>): Dict | null {
  const cards = (deal.propertyCards ?? []) as Dict[];
  return cards.find((card) => text(card.role) === 'subject') ?? cards[0] ?? null;
}


/** Promote the newest complete staged package for a Deal Card, without any
 * provider work. This is safe to call from the normal in-place reconcile action.
 */
export function reconcilePersistedLandPortalEvidence(dealCardId: number): PersistedLandPortalReconcileResult {
  const deal = getDealCard(dealCardId);
  const card = deal ? subjectCard(deal) : null;
  const cardId = typeof card?.id === 'number' ? card.id : null;
  if (!deal || cardId == null) return { promoted: false, runId: null, reason: 'Deal Card has no subject property card.', cardId, compCount: 0, visualCount: 0 };
  const subjectRecord = card as Dict;

  const stages = loadStagedRun(cardId);
  const runId = stages[0]?.runId ?? null;
  const subject = stage(stages, 'subject_parcel');
  const factsStage = stage(stages, 'property_facts');
  if (!runId || !subject || !factsStage) return { promoted: false, runId, reason: 'No completed staged LandPortal subject-and-facts package is available.', cardId, compCount: 0, visualCount: 0 };
  const browserUse = loadBrowserUseRun(cardId);
  if (!browserUse || browserUse.dealCardId !== dealCardId || browserUse.propertyCardId !== cardId || !browserUse.schemaValid || !browserUse.result.complete || browserUse.result.findings?.subject_identity?.parcel_match !== 'confirmed') {
    return { promoted: false, runId, reason: 'Staged evidence is not paired with a completed, validated Browser Use parcel confirmation.', cardId, compCount: 0, visualCount: 0 };
  }

  const already = getLandosDb().prepare("SELECT 1 FROM landos_card_activity WHERE card_id = ? AND kind = 'landportal_evidence_reconciled' AND ref = ? LIMIT 1")
    .get(cardId, runId);

  const rows = flattenFacts(factsStage);
  const resolved = (subject.resolvedIdentity ?? {}) as Dict;
  const apn = value(rows, 'Parcel ID') || text(resolved.apn);
  const address = value(rows, 'Parcel Address') || text(resolved.address);
  const city = value(rows, 'Parcel Address City') || text(resolved.city);
  const zip = value(rows, 'Parcel Address Zip Code');
  const state = value(rows, 'Parcel Address State') || text(resolved.state);
  const county = value(rows, 'Parcel Address County') || text(resolved.county);
  const owner = value(rows, 'Owner Name') || text(resolved.owner);
  const acres = number(factsStage.workingAcreage && typeof factsStage.workingAcreage === 'object' ? (factsStage.workingAcreage as Dict).value : value(rows, 'Acres'));
  const lat = number(value(rows, 'Centroid Latitude') || resolved.lat);
  const lng = number(value(rows, 'Centroid Longitude') || resolved.lng);
  const parcelUrl = text(subject.parcelUrl);
  const fips = text(subjectRecord.fips) || (state.toUpperCase() === 'NY' && /cayuga/i.test(county) ? '36011' : '');
  if (!apn || !state || !county || !address) return { promoted: false, runId, reason: 'Staged package lacks a complete parcel identity.', cardId, compCount: 0, visualCount: 0 };

  upsertCardFromDukeRun({
    cardId, entity: deal.entity as LandosEntity, agentId: 'landportal-persisted-reconciliation',
    activeInputAddress: address, apn, county, state, city, zip, owner, acres: acres ?? undefined,
    fips, lpUrl: parcelUrl || undefined, lat: lat ?? undefined, lng: lng ?? undefined,
    verified: true, verificationSource: 'LandPortal staged package (paired Chrome, parcel sidebar)',
    summary: 'Canonical parcel identity promoted from retained LandPortal staged evidence.',
  });
  writeParcelIdentity(dealCardId, {
    subjectCardId: cardId, state: 'confirmed', confidence: 0.95,
    basis: 'LandPortal staged package: exact parcel sidebar and APN-selected parcel confirmation.',
    evidenceRefs: ['LandPortal parcel sidebar', 'paired Chrome staged capture'],
    confirmedBy: 'landportal-persisted-reconciliation',
  }, 'landportal-persisted-reconciliation');
  synchronizePropertySummarySlice({
    identity: {
      dealCardId, propertyCardId: cardId, status: 'confirmed', address, city: city || null, county, state,
      zip: zip || null, apn, owner: owner || null, acreage: acres,
      basis: 'LandPortal staged package: exact parcel sidebar and APN-selected parcel confirmation.', confidence: 0.95,
      sourceRefs: ['LandPortal parcel sidebar', 'paired Chrome staged capture'],
      changeReason: 'Promoted completed staged LandPortal package into the canonical property record.',
      createdBy: 'landportal-persisted-reconciliation',
    }, publicRun: null,
  });

  const frontage = stage(stages, 'frontage_access') ?? {};
  const wetlands = value(rows, 'Wetlands Coverage (%)');
  const flood = value(rows, 'FEMA Coverage (%)');
  const buildable = value(rows, 'Buildability area (acres)');
  const underTen = (number(value(rows, 'Flat Slope (0-.5%)')) ?? 0) + (number(value(rows, 'Minimal Slope (.5-5%)')) ?? 0) + (number(value(rows, 'Moderate Slope (5-10%)')) ?? 0);
  const sourceLinks = parcelUrl ? [{ label: 'LandPortal staged parcel sidebar', url: parcelUrl }] : [];
  upsertDealCardDd(dealCardId, {
    parcelIdentityStatus: 'source_verified', apn, apnLabel: 'Verified', county, state, locationLabel: 'Verified',
    acreage: acres, acreageLabel: 'Verified',
    accessStatus: `${text(frontage.landLocked) || 'LandLocked status not captured'}; ${text(frontage.roadFrontageDisplayed) || 'road frontage not captured'}`,
    accessLabel: 'Verified',
    floodStatus: flood ? `${flood}% mapped FEMA coverage (screening)` : '', floodLabel: flood ? 'Verified' : undefined,
    wetlandsStatus: wetlands ? `${wetlands}% mapped wetlands coverage (screening)` : '', wetlandsLabel: wetlands ? 'Verified' : undefined,
    roadFrontageNotes: text(frontage.roadFrontageDisplayed) || '', sourceLinks,
    notes: [buildable && `LandPortal source-reported buildability: ${buildable}.`, underTen > 0 && `Under 10% slope: ${underTen.toFixed(2)}%.`, city && `Locality: ${city}.`].filter(Boolean).join(' '),
    updatedBy: 'landportal-persisted-reconciliation',
  });

  const imagery = stage(stages, 'imagery') ?? {};
  const images = retainedImages(stages);
  const sourceRoot = 'store/browser-shots';
  const capturedAt = stages.find((row) => row.stage === 'imagery')?.finishedAt ?? new Date().toISOString();
  const inspection: PendingPropertyInspectionRecord = {
    parcelUrl: parcelUrl || null, comparablesUrl: text(stage(stages, 'comp_rows')?.marketCompsUrl) || null,
    parcelFacts: Object.fromEntries(rows.map((row) => [text(row.label), text(row.value)]).filter(([key, val]) => key && val)),
    assets: images.map((image) => ({
      key: image.key, label: image.label,
      kind: (/comp/i.test(image.label) ? 'comparables_map' : /3d/i.test(image.label) ? 'parcel_3d' : /overlay|wetland|fema|soil|contour/i.test(image.label) ? 'overlay' : 'parcel_page') as 'comparables_map' | 'parcel_3d' | 'overlay' | 'parcel_page',
      purpose: /road.*frontage.*aerial/i.test(image.label) ? 'Canonical hero: road frontage aerial' : 'LandPortal retained staged capture', sourcePath: `${sourceRoot}/${image.file}`,
      timestamp: capturedAt, overlay: /overlay|wetland|fema|soil|contour/i.test(image.label) ? image.overlay || image.label : undefined,
    })).filter((image) => image.key && image.sourcePath),
    overlays: (Array.isArray(imagery.overlayResults) ? imagery.overlayResults as Dict[] : []).map((overlay) => ({
      overlay: text(overlay.overlay), status: 'captured' as const, note: 'Retained LandPortal staged overlay.', confidence: 'medium' as const, screenshotKey: text(overlay.label) || undefined,
    })),
    visualObservations: [], comparables: [], sources: [{ provider: 'LandPortal', stage: 'staged_reconciliation', status: 'used', confidence: 'high', url: parcelUrl || null, note: 'Completed staged parcel package promoted without provider work.' }], evidence: [], discoveryQuestions: [], missingInformation: [],
  };
  saveLandPortalInspection(cardId, inspection);

  const relevance = stage(stages, 'comp_relevance') ?? {};
  const comps = Array.isArray(relevance.comps) ? relevance.comps as Dict[] : [];
  for (const comp of comps) {
    const price = number(comp.price); const compAcres = number(comp.acres);
    if (!price || !compAcres || !text(comp.address) || !text(comp.apn)) continue;
    upsertNormalizedComp({
      entity: deal.entity as LandosEntity, dealCardId, cardId, sourceLabel: 'LandPortal', canonicalSource: 'LandPortal',
      sourceUrl: text(stage(stages, 'comp_rows')?.marketCompsUrl) || parcelUrl, addressDesc: text(comp.address), apn: text(comp.apn),
      county, state, price, priceKind: 'sale', saleOrListDate: isoDate(comp.soldDate), acres: compAcres,
      pricePerAcre: number(comp.pricePerAcre) ?? undefined, thumbnailUrl: text(comp.thumbnailFile) ? `/api/landos/deal-cards/${dealCardId}/browseruse/image/${encodeURIComponent(text(comp.thumbnailFile))}` : undefined,
      propertyClass: 'vacant_land', classification: 'sold_landportal_staged', status: 'verified_sale',
      inclusionReason: 'Retained LandPortal sold comparable, reconciled from the sidebar and map surfaces.',
      notes: `${text(comp.surfaces)}${text(comp.soldBy) ? `; sold by ${text(comp.soldBy)}` : ''}`,
      retrievedAt: capturedAt, sourceAttributions: [{ provider: 'LandPortal', url: text(stage(stages, 'comp_rows')?.marketCompsUrl) || parcelUrl }],
    });
  }

  // Native Market Research is already a retained LandPortal dataset. Promote
  // rows through the same validated Market Matrix ingestion used by live runs;
  // no browser/provider call is made here.
  const marketRows = getLandosDb().prepare(`
    SELECT g.level, g.state, g.fips, g.zip, g.name, m.metrics_json, m.provider, m.source_ref, m.observed_at, s.quarter, s.filters_json
    FROM landos_mr_metric m
    JOIN landos_mr_geography g ON g.id = m.geography_id
    JOIN landos_mr_snapshot s ON s.id = m.snapshot_id
    WHERE g.state = ? AND (g.fips = ? OR g.zip = ?) AND s.status <> 'failed'
  `).all(state.toUpperCase(), fips, zip) as Array<Dict>;
  const marketPayloads: MarketSnapshotPayload[] = [];
  for (const row of marketRows) {
    const level = text(row.level);
    if (level !== 'county' && level !== 'zip') continue;
    let rawMetrics: unknown = {};
    try { rawMetrics = JSON.parse(text(row.metrics_json) || '{}'); } catch { continue; }
    let filter: Dict = {};
    try { filter = JSON.parse(text(row.filters_json) || '{}') as Dict; } catch { /* skip bad filter below */ }
    const acreageBand = text(filter.acreageBand);
    if (!['all', '0-1', '1-2', '2-5', '5-10', '10-20', '20-50', '50-100', '100+', '50+'].includes(acreageBand)) continue;
    marketPayloads.push({
      geography: level === 'county'
        ? { level: 'county', state: text(row.state), fips: text(row.fips), county: text(row.name) || county }
        : { level: 'zip', state: text(row.state), zip: text(row.zip), fips: text(row.fips) || fips },
      acreageBand: acreageBand as MarketSnapshotPayload['acreageBand'], side: 'sold', period: text(row.quarter) || quarter(capturedAt), metrics: metricsFromMr(rawMetrics), confidence: 'medium',
      provenance: { provider: text(row.provider) || 'LandPortal Market Research (retained)', sourceRef: text(row.source_ref) || 'retained native market row', extractionTimestamp: text(row.observed_at) || capturedAt, agentRunId: runId },
    });
  }
  if (marketPayloads.length) ingestMarketSnapshots(marketPayloads);

  const apnDigitRuns = [apn, text(subjectRecord.apn), text(subjectRecord.prior_inputs)]
    .flatMap((raw) => raw.match(/[\d.-]{7,}/g) ?? [])
    .map((raw) => raw.replace(/\D/g, ''))
    .filter((raw) => raw.length >= 7);
  const linkedPeople = getLandosDb().prepare(`SELECT p.id, p.phone FROM landos_person p JOIN landos_person_link l ON l.person_id = p.id WHERE l.deal_card_id = ?`).all(dealCardId) as Array<{ id: number; phone: string }>;
  for (const person of linkedPeople) {
    const candidate = text(person.phone).replace(/\D/g, '');
    if (candidate.length >= 7 && apnDigitRuns.some((parcelDigits) => parcelDigits.includes(candidate))) {
      getLandosDb().prepare("UPDATE landos_person SET phone = '', preferred_contact_method = '', updated_at = strftime('%s','now') WHERE id = ?").run(person.id);
    }
  }


  if (!already) attachCardActivity({ cardId, agentId: 'landportal-persisted-reconciliation', kind: 'landportal_evidence_reconciled', summary: `Promoted staged LandPortal package ${runId} into the canonical property, DD, visual, and comp records.`, ref: runId });
  return { promoted: !already, runId, reason: already ? 'Newest staged package was already promoted; canonical projection refreshed.' : 'Promoted newest staged package into canonical Deal Card records.', cardId, compCount: comps.length, visualCount: inspection.assets.length };
}
