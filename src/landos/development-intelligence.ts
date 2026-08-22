/**
 * SELECT-only projection of retained public-record outcomes into an
 * operator-facing development dossier. The schema is deliberately generic:
 * public-record collectors supply typed facts and this module never branches
 * on a deal id, address, APN, county, or municipality.
 */

export type DevelopmentResearchDepth = 'STANDARD' | 'DEEP_DEVELOPMENT';

export interface DevelopmentSourceView {
  title: string;
  authority: string;
  url: string | null;
  artifactUrl: string | null;
}

export interface AcquisitionEventView {
  date: string | null;
  event: string;
  owner: string | null;
  acreage: number | null;
  instrument: string | null;
  consideration: string | null;
  confidence: 'confirmed' | 'inferred' | 'unresolved';
  sourceTitle: string;
}

export interface RecordedDocumentView {
  category: string;
  title: string;
  authority: string;
  instrument: string | null;
  summary: string;
  retrievalStatus: string;
  imageStatus: 'available' | 'not_publicly_available' | 'not_applicable';
  sourceUrl: string | null;
  artifactUrl: string | null;
}

export interface DevelopmentIntelligenceView {
  researchDepth: DevelopmentResearchDepth;
  researchStatus: {
    run: 'complete';
    underwriting: 'resolved' | 'material_items_unresolved';
    note: string;
  };
  currentTruth: {
    owner: string | null;
    acreage: number | null;
    improvementStatus: string;
    improvementNote: string | null;
    providerAccessSignal: string;
    recordedLegalAccess: string;
    surveyedFrontage: string;
    physicalEntrance: string;
  };
  acquisitionHistory: AcquisitionEventView[];
  documents: RecordedDocumentView[];
  zoning: {
    currentStatus: string;
    lastConfirmed: string | null;
    transition: string | null;
    underwritingRule: string | null;
  } | null;
  authorities: Array<{ role: string; authority: string; responsibility: string }>;
  infrastructure: Array<{ system: string; status: string; authority: string | null }>;
  developmentHistory: Array<{ date: string | null; event: string; status: string; significance: string | null }>;
  paths: Array<{ path: string; practicalYield: string; process: string; economics: string; decision: string }>;
  recommendation: {
    strategy: string;
    basis: string;
    quickFlip: string;
    majorDevelopment: string;
    maximumBasis: string;
  } | null;
  unknowns: string[];
  sources: DevelopmentSourceView[];
}

type PublicRecordRow = Record<string, unknown> & { facts?: Record<string, unknown> };

const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;
const number = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const list = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

function sourceUrl(row: PublicRecordRow): string | null {
  return text(row.source_url) ?? text(row.sourceUrl) ?? text(row.document_url) ?? text(row.documentUrl);
}

function artifactUrl(row: PublicRecordRow, dealCardId?: number | null): string | null {
  const retained = text(row.screenshot_url) ?? text(row.screenshotUrl);
  const recordId = number(row.id);
  return retained && dealCardId != null && recordId != null
    ? `/api/landos/deal-cards/${dealCardId}/public-records/${recordId}/artifact`
    : retained;
}

export function buildDevelopmentIntelligence(input: {
  records: PublicRecordRow[];
  dealCardId?: number | null;
  acres?: number | null;
  owner?: string | null;
  providerAccessSignal?: string | null;
  recordedLegalAccess?: string | null;
  surveyedFrontage?: string | null;
  physicalEntrance?: string | null;
}): DevelopmentIntelligenceView | null {
  if (!input.records.length) return null;
  const facts = input.records.map((row) => ({ row, facts: object(row.facts) ?? {} }));
  const holding = facts.find(({ facts: value }) => value.kind === 'current_holding')?.facts ?? null;
  const zoningFacts = facts.find(({ facts: value }) => value.kind === 'zoning')?.facts ?? null;
  const strategyFacts = facts.find(({ facts: value }) => value.kind === 'development_strategy')?.facts ?? null;

  const acquisitionHistory = facts.flatMap(({ row, facts: value }): AcquisitionEventView[] => {
    const event = object(value.acquisitionEvent);
    if (!event) return [];
    const confidence = event.confidence === 'inferred' || event.confidence === 'unresolved' ? event.confidence : 'confirmed';
    return [{
      date: text(event.date),
      event: text(event.event) ?? text(row.title) ?? 'Recorded event',
      owner: text(event.owner),
      acreage: number(event.acreage),
      instrument: text(event.instrument),
      consideration: text(event.consideration),
      confidence,
      sourceTitle: text(row.title) ?? text(row.authority) ?? 'Official record',
    }];
  }).sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')));

  const documents = input.records.map((row): RecordedDocumentView => {
    const rowFacts = object(row.facts) ?? {};
    const instrument = text(rowFacts.instrument);
    const artifact = artifactUrl(row, input.dealCardId);
    return {
      category: text(row.category) ?? 'public record',
      title: text(row.title) ?? 'Official record',
      authority: text(row.authority) ?? 'Official authority',
      instrument,
      summary: text(row.summary) ?? 'Record retained.',
      retrievalStatus: text(row.retrieval_status) ?? text(row.retrievalStatus) ?? 'retrieved_yes',
      imageStatus: artifact ? 'available' : instrument ? 'not_publicly_available' : 'not_applicable',
      sourceUrl: sourceUrl(row),
      artifactUrl: artifact,
    };
  });

  const authorities = facts.flatMap(({ facts: value }) => list<Record<string, unknown>>(value.authorities))
    .map((entry) => ({
      role: text(entry.role) ?? 'Authority',
      authority: text(entry.authority) ?? 'Unresolved',
      responsibility: text(entry.responsibility) ?? 'Role retained from official source.',
    }));
  const infrastructure = facts.flatMap(({ facts: value }) => list<Record<string, unknown>>(value.infrastructure))
    .map((entry) => ({
      system: text(entry.system) ?? 'Infrastructure',
      status: text(entry.status) ?? 'Unresolved',
      authority: text(entry.authority),
    }));
  const developmentHistory = facts.flatMap(({ facts: value }) => list<Record<string, unknown>>(value.developmentHistory))
    .map((entry) => ({
      date: text(entry.date),
      event: text(entry.event) ?? 'Official action',
      status: text(entry.status) ?? 'Retained',
      significance: text(entry.significance),
    }));
  const paths = facts.flatMap(({ facts: value }) => list<Record<string, unknown>>(value.paths))
    .map((entry) => ({
      path: text(entry.path) ?? 'Development path',
      practicalYield: text(entry.practicalYield) ?? 'Not established',
      process: text(entry.process) ?? 'Agency confirmation required',
      economics: text(entry.economics) ?? 'Not underwritten',
      decision: text(entry.decision) ?? 'Hold pending diligence',
    }));
  const unknowns = [...new Set(facts.flatMap(({ facts: value }) => list<unknown>(value.unknowns)).map(text).filter((value): value is string => !!value))];
  const acres = number(holding?.acreage) ?? input.acres ?? null;
  const deep = (acres ?? 0) >= 25 || acquisitionHistory.length > 1 || developmentHistory.length > 0 || paths.length > 1;

  const sources = input.records.map((row) => ({
    title: text(row.title) ?? 'Official record',
    authority: text(row.authority) ?? 'Official authority',
    url: sourceUrl(row),
    artifactUrl: artifactUrl(row, input.dealCardId),
  }));

  return {
    researchDepth: deep ? 'DEEP_DEVELOPMENT' : 'STANDARD',
    researchStatus: {
      run: 'complete',
      underwriting: unknowns.length ? 'material_items_unresolved' : 'resolved',
      note: unknowns.length
        ? 'Research run complete; material underwriting questions remain explicitly unresolved.'
        : 'Research run complete and the retained decision inputs are resolved.',
    },
    currentTruth: {
      owner: text(holding?.owner) ?? input.owner ?? null,
      acreage: acres,
      improvementStatus: text(holding?.improvementStatus) ?? 'unresolved',
      improvementNote: text(holding?.improvementNote),
      providerAccessSignal: input.providerAccessSignal ?? 'Unresolved',
      recordedLegalAccess: input.recordedLegalAccess ?? 'Not verified',
      surveyedFrontage: input.surveyedFrontage ?? 'Not verified',
      physicalEntrance: input.physicalEntrance ?? 'Not confirmed',
    },
    acquisitionHistory,
    documents,
    zoning: zoningFacts ? {
      currentStatus: text(zoningFacts.currentStatus) ?? 'Unresolved',
      lastConfirmed: text(zoningFacts.lastConfirmed),
      transition: text(zoningFacts.transition),
      underwritingRule: text(zoningFacts.underwritingRule),
    } : null,
    authorities,
    infrastructure,
    developmentHistory,
    paths,
    recommendation: strategyFacts ? {
      strategy: text(strategyFacts.strategy) ?? 'Hold pending diligence',
      basis: text(strategyFacts.basis) ?? 'Current evidence is incomplete.',
      quickFlip: text(strategyFacts.quickFlip) ?? 'Not underwritten',
      majorDevelopment: text(strategyFacts.majorDevelopment) ?? 'Not underwritten',
      maximumBasis: text(strategyFacts.maximumBasis) ?? 'Not established',
    } : null,
    unknowns,
    sources,
  };
}
