// Phase 1 discovery-call package.
//
// This is a deterministic, read-only projection over the canonical opportunity,
// Deal Card, Property Card, research report, evidence, people and visual rows.
// Persisting the projection gives the Lead Card and downloadable PDF one exact
// object to render. It performs no provider/network work and authorizes no paid,
// outbound, offer, contract or pursuit action.

import { createHash } from 'node:crypto';

import { getLandosDb } from './db.js';
import { buildDiscoveryCallReport, type DiscoveryCallReport } from './discovery-call-report.js';
import { buildExecutiveSummary } from './deal-card-executive-summary.js';
import type { MarketResearchInput } from './market-intelligence.js';
import { getDealCard, type DealCardDetail } from './deal-card.js';
import { getDealCardReport, type DealCardReportView } from './deal-card-report.js';
import { getOpportunity, getOpportunityByDealCardId, type OpportunityRecord } from './opportunity.js';
import { getPropertyCard, type PropertyCardDetail } from './property-card.js';

export type PackageConfidence = 'high' | 'medium' | 'low' | 'none';

export interface DiscoveryPackageSource {
  name: string;
  kind: string;
  status: string;
  url: string | null;
  accessedAt: string | null;
  confidence: PackageConfidence;
  note: string;
}

export interface DiscoveryPackageFact {
  key: string;
  label: string;
  value: string | number | boolean | null;
  status: 'verified' | 'observed' | 'seller_stated' | 'needs_verification';
  source: string | null;
  sourceUrl: string | null;
  observedAt: string | null;
  confidence: PackageConfidence;
  parcelAssociated: boolean;
  note: string;
}

export interface DiscoveryPackageVisual {
  key: string;
  label: string;
  kind: string;
  url: string | null;
  status: string;
  source: string;
  capturedAt: string | null;
  confidence: PackageConfidence;
  parcelAssociated: boolean;
  note: string;
}

export interface RankedDiscoveryStrategy {
  rank: 1 | 2;
  name: 'Cash Flip' | 'Subdivide or Minor Split' | 'Novation or Double Close' | 'Land-Home Package' | 'Improvement Then Flip';
  fit: string;
  opportunityLogic: string;
  unknowns: string[];
  validationWork: string[];
  disqualifiers: string[];
  confidence: PackageConfidence;
}

export interface DiscoveryPackage {
  schemaVersion: 3;
  opportunityId: number;
  opportunityPublicUid: string;
  dealCardId: number;
  propertyCardId: number | null;
  sourceUpdatedAt: number;
  contentHash: string;
  identity: {
    leadTitle: string;
    leadSource: string;
    rawInput: string;
    contacts: Array<{ name: string; role: string; phone: string | null; email: string | null; authorityStatus: string; confidence: PackageConfidence }>;
    address: string | null;
    city: string | null;
    county: string | null;
    state: string | null;
    apn: string | null;
    apparentRecordOwners: string[];
    resolutionStatus: string;
    resolved: boolean;
    confidence: PackageConfidence;
    contradictions: string[];
  };
  visuals: DiscoveryPackageVisual[];
  landCharacteristics: DiscoveryPackageFact[];
  deedFindings: {
    status: 'reviewed' | 'partial' | 'not_retrieved';
    findings: DiscoveryPackageFact[];
    owners: string[];
    heirs: string[];
    easements: string[];
    restrictions: string[];
    disclaimer: string;
  };
  lienReview: {
    status: 'reviewed' | 'not_searched';
    findings: DiscoveryPackageFact[];
    disclaimer: string;
  };
  marketPulse: DiscoveryCallReport['marketIntelligence'];
  comparables: DiscoveryCallReport['comparableIntelligence'];
  landScore: {
    score: number | null;
    maxScore: number;
    verdict: string;
    confidence: PackageConfidence;
    subscores: Array<{ key: string; label: string; points: number | null; maxPoints: number | null; confidence: PackageConfidence; gap: string | null }>;
    gaps: string[];
    note: string;
  };
  preliminaryValue: {
    basis: 'parcel' | 'area_context' | 'insufficient';
    marketValue: { low: number | null; mid: number | null; high: number | null } | null;
    pricePerAcre: { low: number | null; mid: number | null; high: number | null };
    ownerReviewAcquisitionRange40To60Pct: { low: number | null; high: number | null } | null;
    confidence: PackageConfidence;
    offerPreparationAllowed: false;
    note: string;
  };
  strategyMode: 'ranked' | 'validation_hypotheses';
  strategies: RankedDiscoveryStrategy[];
  gaps: string[];
  sources: DiscoveryPackageSource[];
  confidence: PackageConfidence;
  callPrep: {
    status: 'ready' | 'incomplete';
    ready: boolean;
    decisionUseful: boolean;
    blockers: string[];
    executiveBrief: string;
    knownFacts: DiscoveryPackageFact[];
    questions: string[];
    nextResearchActions: string[];
    unresolvedIdentityWarning: string | null;
  };
  disclaimer: string;
}

interface EvidenceRow {
  fact?: unknown;
  source_type?: unknown;
  source_url?: unknown;
  date_accessed?: unknown;
  note?: unknown;
  usable_for_offer_logic?: unknown;
}

interface PersonRow {
  name?: unknown;
  phone?: unknown;
  email?: unknown;
  role?: unknown;
  authority_status?: unknown;
}

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const nullable = (value: unknown): string | null => text(value) || null;
const unique = (values: Array<string | null | undefined>): string[] => [...new Set(values.map((v) => (v ?? '').trim()).filter(Boolean))];
const confidence = (value: unknown, fallback: PackageConfidence = 'low'): PackageConfidence =>
  value === 'high' || value === 'medium' || value === 'low' || value === 'none' ? value : fallback;

function canonicalStrategyName(name: string): RankedDiscoveryStrategy['name'] | null {
  if (/cash|quick flip/i.test(name)) return 'Cash Flip';
  if (/subdiv|minor split/i.test(name)) return 'Subdivide or Minor Split';
  if (/novation|double close/i.test(name)) return 'Novation or Double Close';
  if (/land.?home|manufactured/i.test(name)) return 'Land-Home Package';
  if (/improvement|value add/i.test(name)) return 'Improvement Then Flip';
  return null;
}

function factsFromChecklist(report: DealCardReportView, parcelAssociated: boolean): DiscoveryPackageFact[] {
  const facts: DiscoveryPackageFact[] = report.ddFactChecklist.map((row) => ({
    key: row.key,
    label: row.label,
    value: row.value,
    status: row.status,
    source: row.source,
    sourceUrl: row.url ?? null,
    observedAt: row.timestamp ?? null,
    confidence: row.status === 'verified' ? confidence(row.confidence, 'medium') : 'none',
    parcelAssociated: parcelAssociated && row.status === 'verified',
    note: row.status === 'verified'
      ? (row.factKind === 'visual_signal' ? 'Visual signal; not a verified property conclusion.' : 'Persisted source-labeled research fact.')
      : 'Explicit research gap; confirm during research or the discovery call.',
  }));
  const inspection = report.landportalInspection;
  const raw = inspection?.parcelFacts ?? {};
  const usable = (value: unknown): string | null => {
    const textValue = String(value ?? '').trim();
    return textValue && textValue !== '-' ? textValue : null;
  };
  const numberValue = (value: unknown): number | null => {
    const n = Number(String(value ?? '').replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) ? n : null;
  };
  const sourceUrl = inspection?.parcelUrl ?? null;
  const replace = (key: string, label: string, value: string | null): void => {
    if (!value || !sourceUrl) return;
    const row: DiscoveryPackageFact = {
      key, label, value, status: 'verified', source: 'LandPortal verified parcel record', sourceUrl,
      observedAt: null, confidence: 'high', parcelAssociated,
      note: 'Fact shown on the verified parcel record.',
    };
    const index = facts.findIndex((fact) => fact.key === key);
    if (index >= 0) facts[index] = row;
    else facts.push(row);
  };
  const statedAcres = numberValue(raw.Acres);
  const calculatedAcres = numberValue(raw['Calc Acres'] ?? raw['MLS Acres']);
  const acres = statedAcres != null && statedAcres > 0 ? statedAcres : calculatedAcres;
  replace('acres', 'Acreage', acres != null && acres > 0 ? `${acres} ac` : null);
  replace('landUse', 'Land use', usable(raw['Parcel Use Description']));
  replace('wetlandsPct', 'Wetlands coverage', usable(raw['Wetlands Coverage (%)']) ? `${numberValue(raw['Wetlands Coverage (%)']) ?? usable(raw['Wetlands Coverage (%)'])}%` : null);
  replace('femaPct', 'FEMA flood zone', usable(raw['FEMA Flood Zone']));
  replace('slopeAvgDeg', 'Average terrain grade', usable(raw['Slope Avg']) ? `${numberValue(raw['Slope Avg']) ?? usable(raw['Slope Avg'])}%` : null);
  replace('buildabilityPct', 'Buildability', usable(raw['Buildability total (%)']) ? `${numberValue(raw['Buildability total (%)']) ?? usable(raw['Buildability total (%)'])}%` : null);
  const heavy = numberValue(raw['Heavy Slope (10-15%)']) ?? 0;
  const extreme = numberValue(raw['Extreme Slope (15%+)']) ?? 0;
  replace('terrainOver10Pct', 'Terrain at 10%+ grade', heavy + extreme > 0 ? `${(heavy + extreme).toFixed(2)}% of parcel` : null);
  return facts;
}

function visualsFromReport(report: DealCardReportView, parcelAssociated: boolean): DiscoveryPackageVisual[] {
  const landPortal = (report.landportalInspection?.assets ?? []).map((asset) => ({
    key: `browser:${asset.key}`,
    label: asset.label,
    kind: asset.kind,
    url: asset.url || null,
    status: 'captured',
    source: 'Authenticated browser evidence',
    capturedAt: asset.timestamp || null,
    confidence: confidence(asset.note?.match(/high|medium|low/i)?.[0]?.toLowerCase(), 'medium'),
    parcelAssociated,
    note: asset.note ?? 'Read-only browser capture; no paid report or credit action.',
  } satisfies DiscoveryPackageVisual));
  const google = (report.visualContext?.assets ?? []).map((asset) => ({
    key: `google:${asset.service}`,
    label: asset.imageType.replace(/_/g, ' '),
    kind: asset.imageType,
    url: asset.imageUrl ?? asset.deepLink ?? null,
    status: asset.status,
    source: asset.apiService,
    capturedAt: asset.status === 'captured' ? (asset.timestamp || null) : null,
    confidence: asset.status === 'captured' ? 'medium' : 'low',
    parcelAssociated: asset.association?.eligibility === 'eligible' && parcelAssociated,
    note: asset.note || asset.verificationStatus,
  } satisfies DiscoveryPackageVisual));
  return [...landPortal, ...google];
}

function deedSection(property: PropertyCardDetail | undefined, report: DealCardReportView): DiscoveryPackage['deedFindings'] {
  const evidence = (property?.sourceEvidence ?? []) as EvidenceRow[];
  const rows = evidence.filter((row) => /deed|easement|restriction|covenant|heir|trustee|legal description|vesting/i.test(`${text(row.fact)} ${text(row.note)}`));
  const findings = rows.map((row, index): DiscoveryPackageFact => ({
    key: `deed-${index + 1}`,
    label: text(row.fact) || 'Recorded-document finding',
    value: text(row.note) || text(row.fact) || null,
    status: text(row.source_url) ? 'verified' : 'observed',
    source: text(row.source_type) || 'Recorded-document research',
    sourceUrl: nullable(row.source_url),
    observedAt: nullable(row.date_accessed),
    confidence: text(row.source_url) ? 'medium' : 'low',
    parcelAssociated: property?.verification_status === 'verified_property',
    note: 'Automated deed review finding; confirm with title/legal professionals before relying on it.',
  }));
  // The authenticated parcel inspection is the canonical source for its own
  // visible legal-description and book/page fields. These had been preserved
  // in the inspection activity but were omitted from the owner brief whenever
  // a separate source-evidence row had not been created yet.
  const inspection = report.landportalInspection;
  const inspectionFields = Object.entries(inspection?.parcelFacts ?? {})
    .filter(([label, value]) => {
      const normalized = text(value);
      return Boolean(normalized) && normalized !== '-'
        && !/\blink\b/i.test(label)
        && /book\s*(number|#)?|page\s*(number|#)?|legal description|deed|instrument|recording/i.test(label);
    });
  const inspectionFindings = inspectionFields.map(([label, value], index): DiscoveryPackageFact => ({
    key: `inspection-record-${index + 1}`,
    label,
    value,
    status: 'verified',
    source: 'LandPortal parcel record',
    sourceUrl: nullable(inspection?.parcelUrl),
    observedAt: null,
    confidence: 'high',
    parcelAssociated: property?.verification_status === 'verified_property',
    note: 'Recorded reference shown on the verified parcel record.',
  }));
  const ownerFinding: DiscoveryPackageFact[] = property?.owner && inspection?.parcelUrl ? [{
    key: 'inspection-record-owner',
    label: 'Recorded owner',
    value: property.owner,
    status: 'verified',
    source: 'LandPortal parcel record',
    sourceUrl: inspection.parcelUrl,
    observedAt: null,
    confidence: 'high',
    parcelAssociated: property.verification_status === 'verified_property',
    note: 'Owner name shown on the verified parcel record; deed-book and instrument details were not returned by this source.',
  }] : [];
  const allFindings = [...findings, ...ownerFinding, ...inspectionFindings]
    .filter((candidate, index, all) => all.findIndex((existing) => existing.label === candidate.label && existing.value === candidate.value) === index);
  const values = rows.map((row) => `${text(row.fact)}: ${text(row.note)}`);
  return {
    status: allFindings.length ? (allFindings.every((item) => item.sourceUrl) ? 'reviewed' : 'partial') : 'not_retrieved',
    findings: allFindings,
    owners: unique([property?.owner, ...values.filter((v) => /owner|grantee|vesting|trustee/i.test(v))]),
    heirs: unique(values.filter((v) => /heir|probate|estate/i.test(v))),
    easements: unique(values.filter((v) => /easement|right.of.way|access/i.test(v))),
    restrictions: unique(values.filter((v) => /restriction|covenant|hoa/i.test(v))),
    disclaimer: 'Automated deed review is preliminary research only, not title, legal, survey, or signing-authority confirmation.',
  };
}

/** Lien evidence is intentionally independent of deed extraction.  A name-index
 * search can be useful screening evidence, but it is never projected as either
 * a property encumbrance or a clean-title result without the recorded matching
 * and release review captured in its source note. */
function lienSection(property: PropertyCardDetail | undefined): DiscoveryPackage['lienReview'] {
  const rows = ((property?.sourceEvidence ?? []) as EvidenceRow[])
    .filter((row) => /recorded lien review/i.test(text(row.fact)));
  const findings = rows.map((row, index): DiscoveryPackageFact => ({
    key: `lien-${index + 1}`,
    label: 'Recorded lien review',
    value: text(row.note) || null,
    status: text(row.source_url) ? 'verified' : 'observed',
    source: text(row.source_type) || 'Official lien/recorder research',
    sourceUrl: nullable(row.source_url),
    observedAt: nullable(row.date_accessed),
    confidence: text(row.source_url) ? 'medium' : 'low',
    parcelAssociated: property?.verification_status === 'verified_property',
    note: 'Index and recorder screening only; title review remains required before relying on lien priority, release, or clear title.',
  }));
  return {
    status: findings.length ? 'reviewed' : 'not_searched',
    findings,
    disclaimer: 'Recorded-lien screening is not a title search or title opinion. An owner/debtor-name result must be matched to the parcel and checked for releases, satisfactions, priority, and later recordings.',
  };
}

const SCORE_DIMENSIONS = [
  ['identity', 'Identity'], ['land_characteristics', 'Land characteristics'], ['frontage_access', 'Frontage / access'],
  ['wetlands_flood', 'Wetlands / flood'], ['slope_buildability', 'Slope / buildability'],
  ['septic_utilities', 'Septic / utilities'], ['zoning_use', 'Zoning / use'], ['marketability', 'Marketability'],
  ['market_strength_growth', 'Market strength / growth'], ['comp_quality', 'Comp quality'], ['strategy_fit', 'Strategy fit'],
] as const;

function scoreSection(report: DealCardReportView): DiscoveryPackage['landScore'] {
  const score = report.landScore;
  const byId = new Map((score?.factors ?? []).map((factor) => [factor.id, factor]));
  const factorIds: Record<string, string[]> = {
    frontage_access: ['access'], wetlands_flood: ['wetlands', 'fema'], slope_buildability: ['slope_buildability'],
    marketability: ['size_usability'], comp_quality: ['valuation_confidence'],
  };
  const subscores = SCORE_DIMENSIONS.map(([key, label]) => {
    const factors = (factorIds[key] ?? []).map((id) => byId.get(id)).filter((v): v is NonNullable<typeof v> => !!v);
    if (!factors.length) return { key, label, points: null, maxPoints: null, confidence: 'none' as const, gap: `${label} subscore is not established by current evidence.` };
    return {
      key, label,
      points: factors.reduce((sum, factor) => sum + factor.points, 0),
      maxPoints: factors.reduce((sum, factor) => sum + factor.maxPoints, 0),
      confidence: factors.some((factor) => factor.dataGap) ? 'low' as const : 'medium' as const,
      gap: factors.some((factor) => factor.dataGap) ? `${label} has missing source fields.` : null,
    };
  });
  return {
    score: score?.score ?? null,
    maxScore: score?.maxScore ?? 100,
    verdict: score?.verdict ?? 'not_scored',
    confidence: score ? (score.confidence === 'full' ? 'high' : score.confidence === 'reduced' ? 'medium' : 'low') : 'none',
    subscores,
    gaps: unique([...(score?.dataGaps ?? []), ...subscores.map((row) => row.gap)]),
    note: score?.note ?? 'Land Score is not available until parcel-bound evidence supports the rubric. Missing subscores remain explicit gaps.',
  };
}

function strategyGuidance(discovery: DiscoveryCallReport, gaps: string[], supported: boolean): RankedDiscoveryStrategy[] {
  const potentialRank = new Map([['High Potential', 4], ['Moderate Potential', 3], ['Low Potential', 2], ['Not Recommended', 1]]);
  const candidates = discovery.strategyEvaluation
    .map((strategy, index) => ({ strategy, index, name: canonicalStrategyName(strategy.strategy) }))
    .filter((row): row is typeof row & { name: RankedDiscoveryStrategy['name'] } => !!row.name)
    .sort((a, b) => (potentialRank.get(b.strategy.potential) ?? 0) - (potentialRank.get(a.strategy.potential) ?? 0) || a.index - b.index)
    .slice(0, 2);
  const fallbackNames: RankedDiscoveryStrategy['name'][] = ['Cash Flip', 'Subdivide or Minor Split'];
  while (candidates.length < 2) candidates.push({ strategy: discovery.strategyEvaluation[candidates.length]!, index: candidates.length, name: fallbackNames[candidates.length] });
  return candidates.map((row, index) => ({
    rank: (index + 1) as 1 | 2,
    name: row.name,
    fit: supported ? row.strategy.potential : 'Unvalidated hypothesis',
    opportunityLogic: supported
      ? `${row.strategy.reason} ${row.strategy.pricingLogic}`.trim()
      : `${row.name} is only a validation path until parcel identity, land characteristics, and qualified sold comps are established.`,
    unknowns: unique([row.strategy.mainRisk, ...gaps.slice(0, 4)]),
    validationWork: unique(gaps.slice(0, 5)),
    disqualifiers: row.strategy.verdict === 'not viable' ? [row.strategy.mainRisk] : [],
    confidence: supported && row.strategy.potential === 'High Potential' ? 'medium' : 'low',
  }));
}

function sourcesFrom(report: DealCardReportView, property: PropertyCardDetail | undefined): DiscoveryPackageSource[] {
  const rows: DiscoveryPackageSource[] = [
    ...(report.sourceTable ?? []).map((row) => ({ name: row.source, kind: row.kind, status: row.status, url: null, accessedAt: null, confidence: row.status === 'used_non_credit' ? 'medium' as const : 'low' as const, note: row.detail })),
    ...((property?.sourceEvidence ?? []) as EvidenceRow[]).map((row) => ({ name: text(row.source_type) || 'Property evidence', kind: 'property_fact', status: text(row.source_url) ? 'available' : 'uncited', url: nullable(row.source_url), accessedAt: nullable(row.date_accessed), confidence: Number(row.usable_for_offer_logic) === 1 ? 'high' as const : 'low' as const, note: `${text(row.fact)}${text(row.note) ? `: ${text(row.note)}` : ''}` })),
    ...(report.marketComps?.providers ?? []).map((row) => ({ name: row.providerId, kind: 'comparable_market', status: row.status, url: null, accessedAt: null, confidence: row.kept > 0 ? 'medium' as const : 'low' as const, note: `${row.kept} comparable row(s) retained.` })),
  ];
  const seen = new Set<string>();
  return rows.filter((row) => { const key = `${row.name}|${row.kind}|${row.url ?? ''}|${row.note}`; if (seen.has(key)) return false; seen.add(key); return true; });
}

function contactRows(deal: DealCardDetail): DiscoveryPackage['identity']['contacts'] {
  return (deal.people as PersonRow[]).map((person) => ({
    name: text(person.name) || 'Unnamed contact',
    role: text(person.role) || 'unknown_relation',
    phone: nullable(person.phone),
    email: nullable(person.email),
    authorityStatus: text(person.authority_status) || 'unknown',
    confidence: text(person.authority_status) === 'can_sign' ? 'medium' : 'low',
  }));
}

function buildFromCanonical(opportunity: OpportunityRecord, deal: DealCardDetail, property: PropertyCardDetail | undefined, report: DealCardReportView, marketResearch?: MarketResearchInput): Omit<DiscoveryPackage, 'contentHash'> {
  const executive = buildExecutiveSummary(report, marketResearch?.growthSummary ?? undefined);
  const discovery = buildDiscoveryCallReport(report, executive, {
    rawInput: opportunity.rawInput || opportunity.title,
    address: property?.active_input_address,
    city: property?.city,
    county: property?.county,
    state: property?.state,
    apn: property?.apn,
    owner: property?.owner,
    acres: property?.acres,
  }, report.parcelVerified, marketResearch);
  const resolved = report.parcelVerified && property?.verification_status === 'verified_property';
  const landCharacteristics = factsFromChecklist(report, resolved);
  const deedFindings = deedSection(property, report);
  const lienReview = lienSection(property);
  const identityGaps = [
    !resolved ? 'Confirm the exact subject parcel using APN plus county/state or another authoritative identity source.' : '',
    !property?.apn ? 'Confirm the parcel/APN.' : '',
    !property?.county || !property?.state ? 'Confirm county and state.' : '',
    !property?.owner ? 'Confirm the apparent record owner and seller relationship.' : '',
  ];
  const gaps = unique([
    ...identityGaps,
    ...(report.dataGaps ?? []),
    ...(report.nextConfirmations ?? []),
    ...(discovery.comparableIntelligence.evidenceMissing ?? []),
    ...(discovery.marketIntelligence.missingInformation ?? []),
    ...(deedFindings.status === 'not_retrieved' ? ['Retrieve and review the vesting deed, prior instruments, easements, and restrictions.'] : []),
  ]);
  const contacts = contactRows(deal);
  const apparentOwners = unique([property?.owner, ...deedFindings.owners]);
  const knownFacts = landCharacteristics.filter((fact) => fact.status === 'verified').slice(0, 16);
  const baselineQuestions = [
    'Why are you considering selling, and what outcome matters most?',
    'What price are you hoping for, and how did you arrive at it?',
    'What timeline are you working with?',
    'Who owns the property and who must approve or sign, including heirs or other decision-makers?',
    'How is the property accessed, and is that access public or recorded?',
    'What utilities, well, septic or perc information do you know?',
    'What is the current condition, and are there structures, clearing, roads, fencing or other improvements?',
    'Are there liens, back taxes, mortgages, easements, restrictions or HOA obligations?',
    'Have you received prior offers or tried to sell it before?',
    'Would timing or payment structure matter, or is cash at closing the priority?',
  ];
  const gapQuestions = gaps.slice(0, 12).map((gap) => `Can you help clarify: ${gap.replace(/[.]+$/, '')}?`);
  const allSources = sourcesFrom(report, property);
  const sourceUpdatedAt = Math.max(opportunity.updatedAt, property?.updated_at ?? 0, report.generatedAt ?? 0, deal.updated_at);
  const rough = discovery.roughOfferRange;
  const compMarketValue = discovery.comparableIntelligence.estimatedMarketValue;
  const marketValue = rough.marketValue ?? compMarketValue;
  const compPpa = discovery.comparableIntelligence.estimatedPricePerAcre;
  const pricePerAcre = rough.pricePerAcre.mid != null ? rough.pricePerAcre : compPpa;
  const acquisitionRange = rough.acquisition ?? (resolved && compMarketValue?.mid != null
    ? { low: Math.round(compMarketValue.mid * 0.4), high: Math.round(compMarketValue.mid * 0.6) }
    : null);
  const qualifiedSolds = discovery.comparableIntelligence.selectedComparables.filter((row) => row.status === 'sold');
  const associatedVisuals = visualsFromReport(report, resolved).filter((visual) => visual.parcelAssociated && !!visual.url);
  const marketFacts = discovery.marketIntelligence.facts.filter((fact) => fact.value != null && fact.status !== 'unknown');
  const reportBlockers = unique([
    !resolved ? 'Exact parcel identity has not been verified.' : '',
    knownFacts.length < 2 ? 'Fewer than two verified parcel characteristics are available.' : '',
    associatedVisuals.length < 1 ? 'No parcel-associated boundary, satellite, street, overlay, or terrain visual is available.' : '',
    qualifiedSolds.length < 3 ? 'Fewer than three qualified sold land comparables passed status, date, distance, acreage, and type checks.' : '',
    marketFacts.length < 1 ? 'Market Pulse has no sourced local-market fact yet.' : '',
    scoreSection(report).score == null ? 'Land Score is not established from parcel-bound evidence.' : '',
  ]);
  const decisionUseful = reportBlockers.length === 0;
  const packageVisualRows = visualsFromReport(report, resolved);
  const packageScore = scoreSection(report);
  return {
    schemaVersion: 3,
    opportunityId: opportunity.id,
    opportunityPublicUid: opportunity.publicUid,
    dealCardId: deal.id,
    propertyCardId: property?.id ?? null,
    sourceUpdatedAt,
    identity: {
      leadTitle: opportunity.title,
      leadSource: opportunity.source,
      rawInput: opportunity.rawInput,
      contacts,
      address: nullable(property?.active_input_address), city: nullable(property?.city), county: nullable(property?.county), state: nullable(property?.state), apn: nullable(property?.apn),
      apparentRecordOwners: apparentOwners,
      resolutionStatus: property?.verification_status ?? 'unresolved',
      resolved,
      confidence: resolved ? 'high' : 'low',
      contradictions: unique(report.riskFlags ?? []),
    },
    visuals: packageVisualRows,
    landCharacteristics,
    deedFindings,
    lienReview,
    marketPulse: discovery.marketIntelligence,
    comparables: discovery.comparableIntelligence,
    landScore: packageScore,
    preliminaryValue: {
      basis: resolved ? (marketValue ? 'parcel' : 'insufficient') : (marketValue || pricePerAcre.mid != null ? 'area_context' : 'insufficient'),
      marketValue,
      pricePerAcre,
      ownerReviewAcquisitionRange40To60Pct: acquisitionRange,
      confidence: resolved
        ? (marketValue ? confidence(discovery.comparableIntelligence.confidence, 'low') : 'none')
        : (marketValue || pricePerAcre.mid != null ? 'low' : 'none'),
      offerPreparationAllowed: false,
      note: `${rough.note} Internal preliminary guidance only; LandOS does not prepare or send an offer from this package. Owner review is required.`,
    },
    strategyMode: decisionUseful ? 'ranked' : 'validation_hypotheses',
    strategies: strategyGuidance(discovery, gaps, decisionUseful),
    gaps,
    sources: allSources,
    confidence: resolved ? confidence(discovery.confidence, 'medium') : 'low',
    callPrep: {
      status: decisionUseful ? 'ready' : 'incomplete',
      ready: decisionUseful,
      decisionUseful,
      blockers: reportBlockers,
      executiveBrief: decisionUseful
        ? `${executive.headline} ${executive.whatItIs} The pre-call research is decision-useful; use the remaining gaps to guide discovery.`
        : `Pre-call research is incomplete. The discovery call can still proceed, but use identity and seller questions only; do not rely on unsupported parcel, value, score, or strategy conclusions.`,
      knownFacts,
      questions: unique([...gapQuestions, ...baselineQuestions]),
      nextResearchActions: unique([...gaps.slice(0, 12), ...(executive.nextSteps ?? [])]),
      unresolvedIdentityWarning: resolved ? null : 'Property identity is unresolved. Area context may inform questions, but it cannot support parcel claims, confident valuation, offer preparation, or automatic pursuit.',
    },
    disclaimer: 'Discovery-call research only. Not legal, title, survey, appraisal, tax, environmental, or underwriting advice. No offer, contract, payment, paid action, or external communication is authorized.',
  };
}

function withHash(value: Omit<DiscoveryPackage, 'contentHash'>): DiscoveryPackage {
  const contentHash = createHash('sha256').update(JSON.stringify(value)).digest('hex');
  return { ...value, contentHash };
}

export function buildOpportunityDiscoveryPackage(
  opportunityId: number,
  options: { persist?: boolean; actor?: string; marketResearch?: MarketResearchInput } = {},
): DiscoveryPackage {
  const opportunity = getOpportunity(opportunityId);
  if (!opportunity) throw new Error(`opportunity ${opportunityId} not found`);
  if (!opportunity.legacyDealCardId) throw new Error(`opportunity ${opportunityId} has no canonical Deal Card link`);
  const deal = getDealCard(opportunity.legacyDealCardId);
  if (!deal) throw new Error(`Deal Card ${opportunity.legacyDealCardId} not found`);
  const property = opportunity.primaryPropertyCardId ? getPropertyCard(opportunity.primaryPropertyCardId) : undefined;
  const report = getDealCardReport(deal.id);
  const value = withHash(buildFromCanonical(opportunity, deal, property, report, options.marketResearch));
  if (options.persist !== false) persistDiscoveryPackage(value, options.actor);
  return value;
}

/** Route-friendly compatibility seam for current Lead Workspace URLs. */
export function buildDiscoveryPackage(
  dealCardId: number,
  options: { persist?: boolean; actor?: string; marketResearch?: MarketResearchInput } = {},
): DiscoveryPackage {
  return buildOpportunityDiscoveryPackage(getOpportunityByDealCardId(dealCardId).id, options);
}

export function persistDiscoveryPackage(value: DiscoveryPackage, actor = 'Property Research Agent'): void {
  getLandosDb().prepare(`
    INSERT INTO landos_opportunity_discovery_package (
      opportunity_id, package_version, content_hash, package_json,
      source_updated_at, generated_at, updated_by
    ) VALUES (?, ?, ?, ?, ?, unixepoch(), ?)
    ON CONFLICT(opportunity_id) DO UPDATE SET
      package_version = excluded.package_version,
      content_hash = excluded.content_hash,
      package_json = excluded.package_json,
      source_updated_at = excluded.source_updated_at,
      generated_at = excluded.generated_at,
      updated_by = excluded.updated_by
  `).run(value.opportunityId, value.schemaVersion, value.contentHash, JSON.stringify(value), value.sourceUpdatedAt, actor);
}

export function getStoredDiscoveryPackage(opportunityId: number): DiscoveryPackage | undefined {
  const row = getLandosDb().prepare(`
    SELECT package_json FROM landos_opportunity_discovery_package WHERE opportunity_id = ?
  `).get(opportunityId) as { package_json: string } | undefined;
  if (!row) return undefined;
  try { return JSON.parse(row.package_json) as DiscoveryPackage; } catch { return undefined; }
}

const md = (value: unknown): string => String(value ?? 'Not established').replace(/[\r\n]+/g, ' ').trim();
const money = (value: number | null): string => value == null ? 'Not established' : `$${Math.round(value).toLocaleString()}`;

/** Deterministic PDF-ready markdown rendered from the persisted package object.
 * It never re-reads or re-interprets source records, so the Lead Card and PDF
 * cannot drift into contradictory projections. */
export function renderDiscoveryPackageMarkdown(value: DiscoveryPackage): string {
  const lines: string[] = [
    `# Discovery Call Package — ${md(value.identity.leadTitle)}`,
    '',
    `**Opportunity:** ${md(value.opportunityPublicUid)}  `,
    `**Research confidence:** ${value.confidence}  `,
    `**Package status:** ${value.callPrep.status === 'ready' ? 'READY — decision-useful research' : 'INCOMPLETE — call may proceed with questions'}  `,
    `**Identity:** ${md(value.identity.resolutionStatus)}${value.identity.resolved ? '' : ' — unresolved'}  `,
    '',
    '## Executive call brief',
    '',
    value.callPrep.executiveBrief,
  ];
  if (value.callPrep.unresolvedIdentityWarning) lines.push('', `> ${value.callPrep.unresolvedIdentityWarning}`);
  if (value.callPrep.blockers.length) {
    lines.push('', '### Why this package is incomplete', '');
    for (const blocker of value.callPrep.blockers) lines.push(`- ${blocker}`);
  }
  lines.push('', '## Identity and seller', '');
  lines.push(`- Lead source: ${md(value.identity.leadSource)}`);
  lines.push(`- Property: ${md([value.identity.address, value.identity.city, value.identity.county, value.identity.state].filter(Boolean).join(', '))}`);
  lines.push(`- APN: ${md(value.identity.apn)}`);
  lines.push(`- Apparent record owner(s): ${md(value.identity.apparentRecordOwners.join('; '))}`);
  for (const contact of value.identity.contacts) lines.push(`- Contact: ${md(contact.name)} (${md(contact.role)}; authority ${md(contact.authorityStatus)})`);
  lines.push('', '## Known land characteristics', '');
  for (const fact of value.landCharacteristics) lines.push(`- ${md(fact.label)}: ${md(fact.value)} — ${fact.status}; ${md(fact.source)}; confidence ${fact.confidence}`);
  lines.push('', '## Visual evidence', '');
  if (!value.visuals.length) lines.push('- No parcel-associated visual has been captured yet.');
  for (const visual of value.visuals) lines.push(`- ${md(visual.label)}: ${md(visual.status)} — ${md(visual.source)}; confidence ${visual.confidence}${visual.url ? `; ${visual.url}` : ''}`);
  lines.push('', '## Deed findings', '', value.deedFindings.disclaimer);
  if (!value.deedFindings.findings.length) lines.push('', '- Vesting deed and related instruments have not been retrieved/reviewed.');
  for (const fact of value.deedFindings.findings) lines.push(`- ${md(fact.label)}: ${md(fact.value)} — ${md(fact.source)}; confidence ${fact.confidence}`);
  lines.push('', '## Recorded lien review', '', value.lienReview.disclaimer);
  if (!value.lienReview.findings.length) lines.push('', '- No official lien-index or recorder review has been recorded. This is not a clear-title conclusion.');
  for (const fact of value.lienReview.findings) lines.push(`- ${md(fact.label)}: ${md(fact.value)} — ${md(fact.source)}; confidence ${fact.confidence}`);
  lines.push('', '## Market Pulse', '', value.marketPulse.marketPulse);
  for (const fact of value.marketPulse.facts) lines.push(`- ${md(fact.label)}: ${md(fact.value)} — ${fact.status}; confidence ${fact.confidence}`);
  lines.push('', '## Land Score', '', `**Score:** ${value.landScore.score ?? 'Not scored'} / ${value.landScore.maxScore} (${md(value.landScore.verdict)}; confidence ${value.landScore.confidence})`);
  for (const subscore of value.landScore.subscores) lines.push(`- ${subscore.label}: ${subscore.points == null ? 'Not established' : `${subscore.points}/${subscore.maxPoints}`} — ${subscore.gap ?? `confidence ${subscore.confidence}`}`);
  lines.push('', '## Preliminary value and owner-review range', '');
  lines.push(`- Basis: ${value.preliminaryValue.basis}; confidence ${value.preliminaryValue.confidence}`);
  lines.push(`- Preliminary market value: ${money(value.preliminaryValue.marketValue?.low ?? null)} – ${money(value.preliminaryValue.marketValue?.high ?? null)}`);
  lines.push(`- 40–60% owner-review range: ${money(value.preliminaryValue.ownerReviewAcquisitionRange40To60Pct?.low ?? null)} – ${money(value.preliminaryValue.ownerReviewAcquisitionRange40To60Pct?.high ?? null)}`);
  lines.push(`- ${value.preliminaryValue.note}`);
  lines.push('', value.strategyMode === 'ranked' ? '## Two evidence-backed first-look strategies' : '## Strategy validation hypotheses — not ranked recommendations', '');
  for (const strategy of value.strategies) {
    lines.push(`### ${strategy.rank}. ${strategy.name}`, '', `- Fit: ${strategy.fit} (confidence ${strategy.confidence})`, `- Logic: ${strategy.opportunityLogic}`, `- Unknowns: ${md(strategy.unknowns.join('; '))}`, `- Validation: ${md(strategy.validationWork.join('; '))}`, `- Disqualifiers: ${md(strategy.disqualifiers.join('; '))}`, '');
  }
  lines.push('## Gaps and call questions', '');
  for (const gap of value.gaps) lines.push(`- Gap: ${gap}`);
  for (const question of value.callPrep.questions) lines.push(`- Question: ${question}`);
  lines.push('', '## Sources', '');
  for (const source of value.sources) lines.push(`- ${md(source.name)} — ${md(source.status)}; confidence ${source.confidence}${source.url ? `; ${source.url}` : ''}; ${md(source.note)}`);
  lines.push('', '---', '', value.disclaimer, '');
  return lines.join('\n');
}
