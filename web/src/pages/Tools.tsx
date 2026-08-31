import { useEffect, useState } from 'preact/hooks';
import { History, Landmark, Map, Ruler, Scale, Search, Wrench } from 'lucide-preact';

import { ApiError, apiGet, apiPost } from '@/lib/api';

/** The server's plain operator message (e.g. a missing prerequisite) beats the
 *  developer-style "failed: 400" wrapper whenever it exists. */
function plainErrorMessage(caught: unknown): string {
  if (caught instanceof ApiError) {
    const body = caught.body as { error?: unknown } | null;
    if (body && typeof body.error === 'string' && body.error.trim()) return body.error;
  }
  // A network-level fetch failure ("Failed to fetch") is a transport hiccup,
  // not something the operator can act on as-is.
  if (caught instanceof TypeError) return 'The request did not reach LandOS. Try again; if it keeps happening, check the server.';
  return caught instanceof Error ? caught.message : String(caught);
}

interface ResolutionResult {
  invocationId: string;
  status: 'SUCCEEDED' | 'NEEDS_INPUT' | 'FAILED';
  subjectResolution: 'RESOLVED' | 'AMBIGUOUS' | 'UNRESOLVED' | 'ERROR';
  canonicalSubject: { kind: 'property' | 'research_session'; id: string; temporary: boolean; propertyCardId?: number } | null;
  facts: {
    identityBasis?: string;
    canonicalIdentity?: Record<string, unknown>;
    candidates?: Array<Record<string, unknown>>;
  };
  evidence: Array<{ id?: string; source: string; sourceUrl?: string | null; sourceType?: string | null; retrievedAt: string }>;
  warnings: string[];
  missingInformation: string[];
  execution: { mode: 'reuse' | 'refresh'; reused: boolean; durationMs: number };
}

interface AssessorTaxRecord {
  field: string;
  value: string;
  classification: 'official_record' | 'recorded_instrument';
  source: string | null;
  sourceUrl: string | null;
  retrievedAt: string | null;
}

interface AssessorTaxResult {
  invocationId: string;
  status: 'SUCCEEDED' | 'NEEDS_INPUT' | 'FAILED';
  subjectResolution: 'RESOLVED' | 'AMBIGUOUS' | 'UNRESOLVED' | 'ERROR';
  canonicalSubject: { kind: 'property' | 'research_session'; id: string; temporary: boolean; propertyCardId?: number } | null;
  facts: {
    recordStatus: 'official_record_retrieved' | 'retained_record_only' | 'not_retrieved';
    jurisdiction: string | null;
    assessor: Record<string, unknown>;
    tax: Record<string, unknown>;
    improvements: Record<string, unknown>;
    transfer: Record<string, unknown>;
    records: AssessorTaxRecord[];
    sourceAttempts: Array<{ source: string; status: string; note: string }>;
    summary: string;
  };
  evidence: Array<{ id?: string; source: string; sourceUrl?: string | null; sourceType?: string | null; retrievedAt: string }>;
  warnings: string[];
  missingInformation: string[];
  execution: { mode: 'reuse' | 'refresh'; reused: boolean; durationMs: number };
}

interface LandPortalResearchResult {
  invocationId: string;
  status: 'SUCCEEDED' | 'NEEDS_INPUT' | 'FAILED';
  subjectResolution: 'RESOLVED' | 'AMBIGUOUS' | 'UNRESOLVED' | 'ERROR';
  canonicalSubject: { kind: 'property' | 'research_session'; id: string; temporary: boolean; propertyCardId?: number } | null;
  facts: {
    lane: string;
    executed: boolean;
    outcome: 'record_returned' | 'lane_completed' | 'retained_only' | 'not_available';
    parcel: Record<string, unknown> | null;
    comparables: Array<{ saleYear: string | null; salePrice: number | null; acres: number | null; pricePerAcre: number | null; apn: string | null; location: string | null }>;
    retained: { parcelUrl: string | null; parcelFactCount: number; assetCount: number; comparableCount: number };
    sourceAttempts: Array<{ source: string; status: string; note: string }>;
    summary: string;
  };
  evidence: Array<{ id?: string; source: string; sourceUrl?: string | null; sourceType?: string | null; retrievedAt: string }>;
  warnings: string[];
  missingInformation: string[];
  execution: { mode: 'reuse' | 'refresh'; reused: boolean; durationMs: number };
}

interface CompsValuationResult {
  invocationId: string;
  status: 'SUCCEEDED' | 'NEEDS_INPUT' | 'FAILED';
  subjectResolution: 'RESOLVED' | 'AMBIGUOUS' | 'UNRESOLVED' | 'ERROR';
  canonicalSubject: { kind: 'property' | 'research_session'; id: string; temporary: boolean; propertyCardId?: number } | null;
  facts: {
    lane: string;
    executed: boolean;
    outcome: 'valuation_returned' | 'lane_completed' | 'retained_only' | 'not_available';
    subject: { address: string | null; apn: string | null; acres: number | null; improved: boolean; buildingSqft: number | null; valuationScopeLabel: string | null };
    valuation: {
      statusLabel: string; basisLabel: string; statusReason: string; confidence: string;
      landValue: number | null; medianPricePerAcre: number | null; weightedPricePerAcre: number | null;
      retailRangeLow: number | null; retailRangeHigh: number | null;
      acquisitionLevels: { pct40: number; pct50: number; pct60: number } | null;
      valuationSetCount: number; directCount: number; windowLabel: string | null;
    } | null;
    split: { applies: boolean; why: string; landValue: number | null; houseValue: number | null; wholePropertyValue: number | null };
    comps: {
      canonicalCount: number; retainedTotal: number; valuationSetCount: number; activeCount: number;
      mapped: number; unresolvedLocations: number;
      selected: Array<{ key: string; address: string | null; source: string; sourceUrl: string | null; acres: number | null; price: number | null; priceKind: string; pricePerAcre: number | null; dateIso: string | null; distanceMiles: number | null; valuationRole: string | null; inValuationSet: boolean }>;
    };
    sourceAttempts: Array<{ source: string; status: string; note: string }>;
    summary: string;
  };
  evidence: Array<{ id?: string; source: string; sourceUrl?: string | null; sourceType?: string | null; retrievedAt: string }>;
  warnings: string[];
  missingInformation: string[];
  execution: { mode: 'reuse' | 'refresh'; reused: boolean; durationMs: number };
}

interface ZoningSubdivisionResult {
  invocationId: string;
  status: 'SUCCEEDED' | 'NEEDS_INPUT' | 'FAILED';
  subjectResolution: 'RESOLVED' | 'AMBIGUOUS' | 'UNRESOLVED' | 'ERROR';
  canonicalSubject: { kind: 'property' | 'research_session'; id: string; temporary: boolean; propertyCardId?: number } | null;
  facts: {
    lane: string;
    outcome: 'rules_returned' | 'lane_completed' | 'retained_only' | 'not_available';
    jurisdiction: {
      county: string | null; state: string | null; municipality: string | null; incorporationStatus: string | null;
      authorities: Array<{ role: string; name: string | null; level: string | null; determination: string; basis: string | null }>;
      rulePackageKey: string | null; rulePackageReused: boolean;
      retainedJurisdictionDocuments: Array<{ label: string; url: string }>;
    };
    zoning: {
      established: boolean; districtCode: string | null; districtName: string | null; statement: string;
      confidence: string; governingAuthority: string | null;
      nonZoningClassification: { code: string; description: string | null; sourceUrl: string | null } | null;
      historicalReferences: Array<{ kind: string; value: string | null; asOf: string | null; sourceUrl: string | null }>;
    };
    rules: {
      count: number; documentCount: number; ordinanceLabel: string | null; ordinanceUrl: string | null;
      package: Array<{ key: string; label: string; value: string | null; unresolved: string | null; section: string | null; sourceUrl: string | null; confidence: string }>;
    };
    subdivisionByRight: {
      status: string; statusLabel: string; maximumLots: number | null; path: string | null;
      reviewBody: string | null; calculation: string | null; reason: string;
      constraintsApplied: Array<{ constraint: string; value: string; source: string }>;
      missingInputs: string[];
    };
    sources: Array<{ title: string; sourceType: string; url: string | null; jurisdiction: string | null; date: string | null; section: string | null }>;
    limitations: string[];
    summary: string;
  };
  evidence: Array<{ id?: string; source: string; sourceUrl?: string | null; sourceType?: string | null; retrievedAt: string }>;
  warnings: string[];
  missingInformation: string[];
  execution: { mode: 'reuse' | 'refresh'; reused: boolean; durationMs: number };
}

interface PropertyDevelopmentHistoryResult {
  invocationId: string;
  status: 'SUCCEEDED' | 'NEEDS_INPUT' | 'FAILED';
  subjectResolution: 'RESOLVED' | 'AMBIGUOUS' | 'UNRESOLVED' | 'ERROR';
  canonicalSubject: { kind: 'property' | 'research_session'; id: string; temporary: boolean; propertyCardId?: number } | null;
  facts: {
    lane: string;
    outcome: 'history_returned' | 'lane_completed' | 'no_material_history' | 'not_available';
    history: {
      established: boolean; statement: string; eventCount: number;
      events: Array<{
        key: string; eventDate: string | null; eventTypeLabel: string; governingBody: string | null;
        projectName: string | null; statusLabel: string; statusClass: string;
        entitlementEstablished: false; entitlementBasis: string;
        proposedLots: number | null; acres: number | null; summary: string;
        ownerAtTheTime: string | null; applicant: string | null; sourceUrl: string | null; confidence: string;
      }>;
      zoningReferences: Array<{ kind: string; value: string | null; asOf: string | null; sourceUrl: string | null }>;
      narrative: string; highlights: string[]; openQuestions: string[];
    };
    relatedParties: Array<{ name: string; role: string; roleLabel: string; basis: string; sourceUrl: string | null }>;
    crmContacts: Array<{ name: string; role: string }>;
    retainedContext: { documentsHeld: number; findingsHeld: number; summariesHeld: number; documentsReused: number };
    search: { ran: boolean; documentsRetrieved: number; sourcesConsulted: number; note: string };
    sources: Array<{ title: string; sourceType: string; url: string | null; date: string | null; reusedFromStorage: boolean }>;
    limitations: string[];
    summary: string;
  };
  evidence: Array<{ id?: string; source: string; sourceUrl?: string | null; sourceType?: string | null; retrievedAt: string }>;
  warnings: string[];
  missingInformation: string[];
  execution: { mode: 'reuse' | 'refresh'; reused: boolean; durationMs: number };
}

const ZONING_SUBDIVISION_OUTCOME_LABEL: Record<ZoningSubdivisionResult['facts']['outcome'], string> = {
  rules_returned: 'Land-use rules returned',
  lane_completed: 'Research lane completed',
  retained_only: 'Retained land-use record only',
  not_available: 'No land-use rules established',
};

const PROPERTY_HISTORY_OUTCOME_LABEL: Record<PropertyDevelopmentHistoryResult['facts']['outcome'], string> = {
  history_returned: 'Material history established',
  lane_completed: 'Bounded search completed',
  no_material_history: 'No material history established',
  not_available: 'No retained record for this subject',
};

const COMPS_VALUATION_OUTCOME_LABEL: Record<CompsValuationResult['facts']['outcome'], string> = {
  valuation_returned: 'Valuation returned',
  lane_completed: 'Comps & Valuation lane completed',
  retained_only: 'Retained comp evidence only',
  not_available: 'No valuation established',
};

const LANDPORTAL_OUTCOME_LABEL: Record<LandPortalResearchResult['facts']['outcome'], string> = {
  record_returned: 'LandPortal record returned',
  lane_completed: 'LandPortal lane completed',
  retained_only: 'Retained LandPortal evidence only',
  not_available: 'No LandPortal record retrieved',
};

interface MarketMatrixSectionView {
  available: boolean;
  coverageLabel: string;
  resolvedKeyLabel: string | null;
  fields: Array<{ label: string; value: string | null; unknown: boolean }>;
}

interface MarketToolResult {
  invocationId: string;
  status: 'SUCCEEDED' | 'NEEDS_INPUT' | 'FAILED';
  facts: {
    geographyLabel?: string;
    outcome?: string;
    summary?: string;
    sold?: { section?: MarketMatrixSectionView; resolution?: { available: boolean; resolvedKeyLabel: string | null; period: string | null; source: string | null } };
    forSale?: { section?: MarketMatrixSectionView };
    pulse?: {
      label?: string;
      plainEnglish?: string;
      growth?: { direction: string; pctChange: number | null; note: string; source: string | null };
      countyPricePerAcre?: { medianPpa: number | null; sampleSize: number; note: string };
      zipPricePerAcre?: { medianPpa: number | null; sampleSize: number; note: string } | null;
    };
  };
  evidence: Array<{ source: string; retrievedAt: string }>;
  warnings: string[];
  missingInformation: string[];
  execution: { mode: 'reuse' | 'refresh'; reused: boolean; durationMs: number };
}

interface CatalogCapability {
  id: string;
  name: string;
  contractVersion: string;
  description: string;
  prerequisites?: Array<string | string[]>;
  operator?: {
    manualInvocation: boolean;
    runsWithoutDeal: boolean;
    writesAuthoritativeEvidence: boolean;
    inputHint: string;
    skill?: string;
    recovery?: string;
  };
}

const PREREQUISITE_LABEL: Record<string, string> = {
  parcel: 'a resolvable property (or an existing Deal)',
  county: 'a county',
  zip: 'a ZIP',
  owner: 'an owner of record',
  seller_communications: 'seller communications',
};

function prerequisiteSentence(prerequisites: Array<string | string[]> | undefined): string {
  if (!prerequisites || prerequisites.length === 0) return 'Nothing — raw input is enough.';
  const clause = (c: string | string[]) => Array.isArray(c)
    ? c.map((p) => PREREQUISITE_LABEL[p] ?? p).join(' or ')
    : PREREQUISITE_LABEL[c] ?? c;
  return `Needs ${prerequisites.map(clause).join(' and ')}.`;
}

const MARKET_TOOL_LABEL: Record<string, string> = {
  'market-pulse': 'Market Pulse',
  'county-market-research': 'County Market Research',
  'zip-market-research': 'ZIP Market Research',
};

const RECORD_STATUS_LABEL: Record<AssessorTaxResult['facts']['recordStatus'], string> = {
  official_record_retrieved: 'Official record retrieved',
  retained_record_only: 'Retained record only',
  not_retrieved: 'No record retrieved',
};

function usd(amount: number | null | undefined): string {
  return typeof amount === 'number' && Number.isFinite(amount)
    ? `$${Math.round(amount).toLocaleString('en-US')}`
    : 'Not established';
}

function value(value: unknown): string {
  if (value == null || value === '') return 'Not established';
  if (Array.isArray(value)) return value.join(', ') || 'Not established';
  return String(value);
}

export function Tools() {
  const [rawInput, setRawInput] = useState('');
  const [result, setResult] = useState<ResolutionResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assessor, setAssessor] = useState<AssessorTaxResult | null>(null);
  const [assessorRunning, setAssessorRunning] = useState(false);
  const [assessorError, setAssessorError] = useState<string | null>(null);
  const [landPortal, setLandPortal] = useState<LandPortalResearchResult | null>(null);
  const [landPortalRunning, setLandPortalRunning] = useState(false);
  const [landPortalError, setLandPortalError] = useState<string | null>(null);
  const [compsValuation, setCompsValuation] = useState<CompsValuationResult | null>(null);
  const [compsRunning, setCompsRunning] = useState(false);
  const [compsError, setCompsError] = useState<string | null>(null);
  const [zoning, setZoning] = useState<ZoningSubdivisionResult | null>(null);
  const [zoningRunning, setZoningRunning] = useState(false);
  const [zoningError, setZoningError] = useState<string | null>(null);
  const [history, setHistory] = useState<PropertyDevelopmentHistoryResult | null>(null);
  const [historyRunning, setHistoryRunning] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [lpToolResults, setLpToolResults] = useState<Record<string, { status?: string; facts?: Record<string, unknown> }>>({});
  const [lpToolRunning, setLpToolRunning] = useState<string | null>(null);
  const [lpToolError, setLpToolError] = useState<string | null>(null);
  const [deals, setDeals] = useState<Array<{ id: number; title: string; status: string }>>([]);
  // The deal selection survives a hard refresh (per-tab, never cross-session).
  const [selectedDealId, setSelectedDealId] = useState<number | null>(() => {
    try {
      const stored = Number(sessionStorage.getItem('landos.tools.dealCardId'));
      return Number.isInteger(stored) && stored > 0 ? stored : null;
    } catch { return null; }
  });
  const selectDeal = (id: number | null) => {
    setSelectedDealId(id);
    try {
      if (id == null) sessionStorage.removeItem('landos.tools.dealCardId');
      else sessionStorage.setItem('landos.tools.dealCardId', String(id));
    } catch { /* per-tab convenience only */ }
  };
  const [marketInput, setMarketInput] = useState('');
  const [marketRunning, setMarketRunning] = useState<string | null>(null);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [marketResults, setMarketResults] = useState<Record<string, MarketToolResult>>({});

  // Existing Deals for subject reuse: a Tools run against a selected Deal
  // consumes that Deal's canonical Subject State and never re-resolves it.
  useEffect(() => {
    let cancelled = false;
    void apiGet<{ dealCards: Array<{ id: number; title: string; status: string }> }>('/api/landos/deal-cards')
      .then((response) => { if (!cancelled) setDeals(response.dealCards ?? []); })
      .catch(() => { /* the picker is a convenience; raw input still works */ });
    return () => { cancelled = true; };
  }, []);

  /** Body for a property-capability invoke: the selected Deal's canonical
   *  subject when one is chosen, the raw operator input otherwise. */
  const propertySubjectBody = (extra: Record<string, unknown> = {}): Record<string, unknown> =>
    selectedDealId != null
      ? { dealCardId: selectedDealId, entity: 'TY_LAND_BIZ', ...extra }
      : { rawInput: rawInput.trim(), entity: 'TY_LAND_BIZ', ...extra };
  const hasPropertySubject = selectedDealId != null || !!rawInput.trim();

  const run = async (refresh = false) => {
    if (!rawInput.trim() || running) return;
    setRunning(true);
    setError(null);
    try {
      const response = await apiPost<{ result: ResolutionResult }>('/api/landos/capabilities/property-resolution/invoke', {
        rawInput: rawInput.trim(),
        entity: 'TY_LAND_BIZ',
        refresh,
      });
      setResult(response.result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRunning(false);
    }
  };

  // Assessor & Tax runs the shared LandOS Capability. Property Resolution
  // establishes the subject first; this never creates a lead or a Deal Card.
  const runAssessorTax = async (refresh = false) => {
    if (!hasPropertySubject || assessorRunning) return;
    setAssessorRunning(true);
    setAssessorError(null);
    try {
      const response = await apiPost<{ resolution: ResolutionResult | null; result: AssessorTaxResult }>(
        '/api/landos/capabilities/assessor-tax/invoke',
        propertySubjectBody({ refresh }),
      );
      if (response.resolution) setResult(response.resolution);
      setAssessor(response.result);
    } catch (caught) {
      setAssessorError(plainErrorMessage(caught));
    } finally {
      setAssessorRunning(false);
    }
  };

  // LandPortal Research runs the shared LandOS Capability. Property Resolution
  // establishes the subject first; this never creates a lead or a Deal Card.
  const runLandPortalResearch = async (refresh = false) => {
    if (!hasPropertySubject || landPortalRunning) return;
    setLandPortalRunning(true);
    setLandPortalError(null);
    try {
      const response = await apiPost<{ resolution: ResolutionResult | null; result: LandPortalResearchResult }>(
        '/api/landos/capabilities/landportal-research/invoke',
        propertySubjectBody({ refresh }),
      );
      if (response.resolution) setResult(response.resolution);
      setLandPortal(response.result);
    } catch (caught) {
      setLandPortalError(plainErrorMessage(caught));
    } finally {
      setLandPortalRunning(false);
    }
  };

  // Comps & Valuation runs the shared LandOS Capability. Property Resolution
  // establishes the subject first; this never creates a lead or a Deal Card.
  const runCompsValuation = async (refresh = false) => {
    if (!hasPropertySubject || compsRunning) return;
    setCompsRunning(true);
    setCompsError(null);
    try {
      const response = await apiPost<{ resolution: ResolutionResult | null; result: CompsValuationResult }>(
        '/api/landos/capabilities/comps-valuation/invoke',
        propertySubjectBody({ refresh }),
      );
      if (response.resolution) setResult(response.resolution);
      setCompsValuation(response.result);
    } catch (caught) {
      setCompsError(plainErrorMessage(caught));
    } finally {
      setCompsRunning(false);
    }
  };

  // Zoning & Subdivision runs the shared LandOS Capability. Property Resolution
  // establishes the subject first; this never creates a lead or a Deal Card.
  // The LOCATION question: what rules apply because of where the parcel is.
  const runZoningSubdivision = async (refresh = false) => {
    if (!hasPropertySubject || zoningRunning) return;
    setZoningRunning(true);
    setZoningError(null);
    try {
      const response = await apiPost<{ resolution: ResolutionResult | null; result: ZoningSubdivisionResult }>(
        '/api/landos/capabilities/zoning-subdivision/invoke',
        propertySubjectBody({ refresh, research: true }),
      );
      if (response.resolution) setResult(response.resolution);
      setZoning(response.result);
    } catch (caught) {
      setZoningError(plainErrorMessage(caught));
    } finally {
      setZoningRunning(false);
    }
  };

  // Property Development History runs the shared LandOS Capability. The
  // PROPERTY question: what has happened to this exact parcel. Retained context
  // is consumed first, and any additional search is bounded.
  const runPropertyDevelopmentHistory = async (refresh = false) => {
    if (!hasPropertySubject || historyRunning) return;
    setHistoryRunning(true);
    setHistoryError(null);
    try {
      const response = await apiPost<{ resolution: ResolutionResult | null; result: PropertyDevelopmentHistoryResult }>(
        '/api/landos/capabilities/property-development-history/invoke',
        propertySubjectBody({ refresh, research: true }),
      );
      if (response.resolution) setResult(response.resolution);
      setHistory(response.result);
    } catch (caught) {
      setHistoryError(plainErrorMessage(caught));
    } finally {
      setHistoryRunning(false);
    }
  };

  // The LandPortal three-tool split: Property Characteristics, Visual Capture
  // and Comp Search are separately callable capabilities with their own runs.
  const runLandPortalTool = async (tool: 'landportal-property-characteristics' | 'landportal-visual-capture' | 'landportal-comp-search') => {
    if (!hasPropertySubject || lpToolRunning) return;
    setLpToolRunning(tool);
    setLpToolError(null);
    try {
      const response = await apiPost<{ result: { status?: string; facts?: Record<string, unknown> } }>(
        `/api/landos/capabilities/${tool}/invoke`,
        propertySubjectBody(),
      );
      setLpToolResults((prior) => ({ ...prior, [tool]: response.result }));
    } catch (caught) {
      setLpToolError(plainErrorMessage(caught));
    } finally {
      setLpToolRunning(null);
    }
  };

  // The catalog is the registry, verbatim: GET /api/landos/capabilities is the
  // one authoritative manifest, and this section renders it without invention.
  const [catalog, setCatalog] = useState<CatalogCapability[]>([]);
  useEffect(() => {
    let cancelled = false;
    void apiGet<{ capabilities: CatalogCapability[] }>('/api/landos/capabilities')
      .then((response) => { if (!cancelled) setCatalog(response.capabilities ?? []); })
      .catch(() => { /* the catalog is informational; the tools above still work */ });
    return () => { cancelled = true; };
  }, []);

  // The geography market tools run the SAME registered capabilities any other
  // caller uses. Their prerequisite is a county or ZIP — never a parcel — and
  // they never create a lead, a Deal Card, or a property card.
  const runMarketTool = async (tool: 'market-pulse' | 'county-market-research' | 'zip-market-research') => {
    if (!marketInput.trim() || marketRunning) return;
    setMarketRunning(tool);
    setMarketError(null);
    try {
      const response = await apiPost<{ result: MarketToolResult }>(
        `/api/landos/capabilities/${tool}/invoke`,
        { rawInput: marketInput.trim(), entity: 'TY_LAND_BIZ' },
      );
      setMarketResults((prior) => ({ ...prior, [tool]: response.result }));
    } catch (caught) {
      setMarketError(plainErrorMessage(caught));
    } finally {
      setMarketRunning(null);
    }
  };

  const identity = result?.facts.canonicalIdentity ?? {};
  const parcel = (landPortal?.facts.parcel ?? {}) as Record<string, unknown>;
  return (
    <div class="h-full overflow-y-auto bg-[var(--color-bg)] px-5 py-6 md:px-8" data-testid="tools-page">
      <div class="mx-auto max-w-5xl space-y-5">
        <header>
          <div class="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
            <Wrench size={15} /> Tools
          </div>
          <h1 class="mt-2 text-3xl font-semibold text-[var(--color-text)]">Property Research</h1>
          <p class="mt-2 max-w-3xl text-sm leading-6 text-[var(--color-text-muted)]">
            Resolve a property reference without creating a lead. LandOS keeps the result in a temporary research session unless it matches an existing canonical property.
          </p>
        </header>

        <section class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5" data-testid="property-resolver-tool">
          <div class="flex items-center gap-2 font-semibold"><Search size={17} /> Property Resolver</div>
          <label class="mt-4 block text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]" for="tools-deal-select">
            Use an existing Deal (optional)
          </label>
          <select
            id="tools-deal-select"
            data-testid="tools-deal-select"
            value={selectedDealId ?? ''}
            onChange={(event) => {
              const value = event.currentTarget.value;
              selectDeal(value ? Number(value) : null);
            }}
            class="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
          >
            <option value="">No Deal selected — research the raw input below</option>
            {deals.map((deal) => (
              <option key={deal.id} value={String(deal.id)}>{deal.title}</option>
            ))}
          </select>
          {selectedDealId != null && (
            <p class="mt-2 text-xs text-[var(--color-text-muted)]" data-testid="tools-deal-subject-note">
              Research runs against this Deal's canonical subject — LandOS will not re-resolve or reinterpret its identity. Clear the selection to research raw input instead.
            </p>
          )}
          <label class="mt-4 block text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]" for="property-resolver-input">
            Raw property reference
          </label>
          <textarea
            id="property-resolver-input"
            data-testid="property-resolver-input"
            value={rawInput}
            onInput={(event) => setRawInput(event.currentTarget.value)}
            rows={5}
            class="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-3 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
            placeholder={'Address, APN, owner + county, coordinates, or a messy reference such as “Map 042 Parcel 123, Fairview, Tennessee”'}
          />
          <div class="mt-3 flex flex-wrap gap-2">
            <button type="button" data-testid="property-resolver-run" disabled={running || !rawInput.trim()} onClick={() => void run(false)} class="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-black disabled:opacity-50">
              {running ? 'Resolving…' : 'Resolve property'}
            </button>
            {result && <button type="button" disabled={running} onClick={() => void run(true)} class="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-semibold disabled:opacity-50">Refresh sources</button>}
            <button type="button" data-testid="assessor-tax-run" disabled={assessorRunning || !hasPropertySubject} onClick={() => void runAssessorTax(false)} class="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-semibold disabled:opacity-50">
              {assessorRunning ? 'Reading assessor record…' : 'Run Assessor & Tax'}
            </button>
            <button type="button" data-testid="landportal-research-run" disabled={landPortalRunning || !hasPropertySubject} onClick={() => void runLandPortalResearch(false)} class="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-semibold disabled:opacity-50">
              {landPortalRunning ? 'Reading LandPortal record…' : 'Run LandPortal Research'}
            </button>
            <button type="button" data-testid="comps-valuation-run" disabled={compsRunning || !hasPropertySubject} onClick={() => void runCompsValuation(false)} class="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-semibold disabled:opacity-50">
              {compsRunning ? 'Reading comp and valuation evidence…' : 'Run Comps & Valuation'}
            </button>
            <button type="button" data-testid="zoning-subdivision-run" disabled={zoningRunning || !hasPropertySubject} onClick={() => void runZoningSubdivision(false)} class="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-semibold disabled:opacity-50">
              {zoningRunning ? 'Researching the land-use rules…' : 'Run Zoning & Subdivision'}
            </button>
            <button type="button" data-testid="property-development-history-run" disabled={historyRunning || !hasPropertySubject} onClick={() => void runPropertyDevelopmentHistory(false)} class="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-semibold disabled:opacity-50">
              {historyRunning ? 'Reading the parcel record…' : 'Run Property Development History'}
            </button>
            <button type="button" data-testid="landportal-property-characteristics-run" disabled={!!lpToolRunning || !hasPropertySubject} onClick={() => void runLandPortalTool('landportal-property-characteristics')} class="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-semibold disabled:opacity-50">
              {lpToolRunning === 'landportal-property-characteristics' ? 'Extracting LandPortal characteristics…' : 'Run LandPortal Property Characteristics'}
            </button>
            <button type="button" data-testid="landportal-visual-capture-run" disabled={!!lpToolRunning || !hasPropertySubject} onClick={() => void runLandPortalTool('landportal-visual-capture')} class="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-semibold disabled:opacity-50">
              {lpToolRunning === 'landportal-visual-capture' ? 'Capturing LandPortal visuals…' : 'Run LandPortal Visual Capture'}
            </button>
            <button type="button" data-testid="landportal-comp-search-run" disabled={!!lpToolRunning || !hasPropertySubject} onClick={() => void runLandPortalTool('landportal-comp-search')} class="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-semibold disabled:opacity-50">
              {lpToolRunning === 'landportal-comp-search' ? 'Running LandPortal comp search…' : 'Run LandPortal Comp Search'}
            </button>
          </div>
          <p class="mt-2 text-xs text-[var(--color-text-muted)]">
            Assessor &amp; Tax resolves the subject first, then reads the assessor and taxing-jurisdiction record.
            LandPortal Research resolves the subject first, then reads the LandPortal record for that exact parcel.
            Comps &amp; Valuation resolves the subject first, then reads the comparable evidence and the valuation LandOS retains for it.
            Zoning &amp; Subdivision establishes the controlling jurisdiction and its rules, then applies them to the parcel.
            Property Development History reads what LandOS already retained about this exact parcel, then runs one bounded targeted search.
            Nothing here creates a lead or a Deal Card.
          </p>
          {error && <div class="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300" role="alert">{error}</div>}
          {lpToolError && <div class="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300" role="alert">{lpToolError}</div>}
          {Object.entries(lpToolResults).length > 0 && (
            <div class="mt-3 space-y-2" data-testid="landportal-tool-results">
              {Object.entries(lpToolResults).map(([tool, run]) => (
                <div key={tool} class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3 text-sm">
                  <div class="font-semibold">{tool.replace(/landportal-/, 'LandPortal ').replace(/-/g, ' ')}</div>
                  <div class="mt-1 text-[var(--color-text-muted)]">{String(run.facts?.summary ?? run.status ?? 'No summary returned.')}</div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5" data-testid="market-tools">
          <div class="flex items-center gap-2 font-semibold"><Map size={17} /> Market Research</div>
          <label class="mt-4 block text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]" for="market-geography-input">
            Geography — county or ZIP, no parcel needed
          </label>
          <input
            id="market-geography-input"
            data-testid="market-geography-input"
            value={marketInput}
            onInput={(event) => setMarketInput(event.currentTarget.value)}
            class="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-3 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
            placeholder={'“Iredell County, NC” or a ZIP such as “28115”'}
          />
          <div class="mt-3 flex flex-wrap gap-2">
            <button type="button" data-testid="market-pulse-run" disabled={!!marketRunning || !marketInput.trim()} onClick={() => void runMarketTool('market-pulse')} class="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-black disabled:opacity-50">
              {marketRunning === 'market-pulse' ? 'Reading the market pulse…' : 'Run Market Pulse'}
            </button>
            <button type="button" data-testid="county-market-research-run" disabled={!!marketRunning || !marketInput.trim()} onClick={() => void runMarketTool('county-market-research')} class="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-semibold disabled:opacity-50">
              {marketRunning === 'county-market-research' ? 'Reading county market data…' : 'Run County Market Research'}
            </button>
            <button type="button" data-testid="zip-market-research-run" disabled={!!marketRunning || !marketInput.trim()} onClick={() => void runMarketTool('zip-market-research')} class="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-semibold disabled:opacity-50">
              {marketRunning === 'zip-market-research' ? 'Reading ZIP market data…' : 'Run ZIP Market Research'}
            </button>
          </div>
          <p class="mt-2 text-xs text-[var(--color-text-muted)]">
            Market Pulse and County Market Research need a county; ZIP Market Research needs a ZIP.
            All three read the market data LandOS already retains — nothing here creates a lead, spends a credit, or attributes data to a parcel.
          </p>
          {marketError && <div class="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300" role="alert" data-testid="market-tools-error">{marketError}</div>}
          {Object.entries(marketResults).length > 0 && (
            <div class="mt-3 space-y-3" data-testid="market-tool-results">
              {Object.entries(marketResults).map(([tool, run]) => (
                <div key={tool} class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-4 text-sm" data-testid={`market-result-${tool}`}>
                  <div class="flex items-center justify-between">
                    <div class="font-semibold">{MARKET_TOOL_LABEL[tool] ?? tool}</div>
                    <div class="text-xs text-[var(--color-text-muted)]">{run.facts.geographyLabel ?? ''}{run.execution.reused ? ' · reused retained run' : ''}</div>
                  </div>
                  {tool === 'market-pulse' && run.facts.pulse && (
                    <div class="mt-2 space-y-2">
                      <div class="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{run.facts.pulse.label}</div>
                      <p class="leading-6">{run.facts.pulse.plainEnglish}</p>
                      {run.facts.pulse.growth && (
                        <div class="text-[var(--color-text-muted)]">Growth: {run.facts.pulse.growth.direction}{typeof run.facts.pulse.growth.pctChange === 'number' ? ` (${run.facts.pulse.growth.pctChange > 0 ? '+' : ''}${run.facts.pulse.growth.pctChange}%)` : ''} — {run.facts.pulse.growth.note}</div>
                      )}
                      {run.facts.pulse.countyPricePerAcre && (
                        <div class="text-[var(--color-text-muted)]">County $/acre: {run.facts.pulse.countyPricePerAcre.note}</div>
                      )}
                    </div>
                  )}
                  {tool !== 'market-pulse' && (
                    <div class="mt-2 space-y-2">
                      {(['sold', 'forSale'] as const).map((side) => {
                        const section = run.facts[side]?.section;
                        if (!section) return null;
                        return (
                          <div key={side}>
                            <div class="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                              {side === 'sold' ? 'Sold' : 'For sale'} · {section.available ? (section.resolvedKeyLabel ?? section.coverageLabel) : 'No retained data yet'}
                            </div>
                            {section.available && (
                              <div class="mt-1 grid grid-cols-2 gap-x-6 gap-y-1 md:grid-cols-4">
                                {section.fields.filter((f) => !f.unknown).map((f) => (
                                  <div key={f.label}><span class="text-[var(--color-text-muted)]">{f.label}:</span> {f.value}</div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div class="mt-2 text-xs text-[var(--color-text-muted)]">{run.facts.summary}</div>
                  {run.missingInformation.length > 0 && (
                    <div class="mt-2 text-xs text-[var(--color-text-muted)]"><b>Data gaps:</b> {run.missingInformation.join(' ')}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {catalog.length > 0 && (
          <section class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5" data-testid="capability-catalog">
            <div class="flex items-center gap-2 font-semibold"><Landmark size={17} /> Capability Catalog</div>
            <p class="mt-2 text-sm text-[var(--color-text-muted)]">
              Every registered LandOS research capability, straight from the registry. The same capabilities serve New Lead, Deal Cards, and these Tools — one capability, multiple callers.
            </p>
            <div class="mt-4 space-y-2" data-testid="capability-catalog-list">
              {catalog.filter((cap) => cap.operator?.manualInvocation).map((cap) => (
                <div key={cap.id} class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-4 text-sm" data-testid={`catalog-${cap.id}`}>
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="font-semibold">{cap.name}</span>
                    {cap.operator?.runsWithoutDeal && (
                      <span class="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">No Deal needed</span>
                    )}
                    {cap.operator?.writesAuthoritativeEvidence && (
                      <span class="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">Writes evidence</span>
                    )}
                    {cap.operator?.skill && (
                      <span class="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">Skill: {cap.operator.skill}</span>
                    )}
                  </div>
                  <p class="mt-1 leading-6 text-[var(--color-text-muted)]">{cap.description}</p>
                  <p class="mt-1 text-xs text-[var(--color-text-muted)]">
                    <b>{prerequisiteSentence(cap.prerequisites)}</b> Input: {cap.operator?.inputHint}
                  </p>
                  {cap.operator?.recovery && (
                    <p class="mt-1 text-xs text-[var(--color-text-muted)]">Recovery: {cap.operator.recovery}</p>
                  )}
                </div>
              ))}
            </div>
            {catalog.some((cap) => !cap.operator?.manualInvocation) && (
              <div class="mt-4 text-xs text-[var(--color-text-muted)]" data-testid="capability-catalog-internal">
                Runs automatically inside Deal Cards (not manually invocable here):{' '}
                {catalog.filter((cap) => !cap.operator?.manualInvocation).map((cap) => cap.name).join(' · ')}
              </div>
            )}
          </section>
        )}

        {result && (
          <section class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5" data-testid="property-resolver-result">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div class="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Resolution result</div>
                <div class="mt-1 text-2xl font-semibold" data-testid="property-resolution-status">{result.subjectResolution.replace('_', ' ')}</div>
              </div>
              <div class="rounded-full border border-[var(--color-border)] px-3 py-1 text-xs text-[var(--color-text-muted)]">
                {result.execution.reused ? 'Reused persisted result' : `${result.execution.mode} · ${result.execution.durationMs} ms`}
              </div>
            </div>

            <p class="mt-3 text-sm leading-6 text-[var(--color-text-muted)]">{result.facts.identityBasis || 'LandOS did not establish one exact parcel.'}</p>
            <dl class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[
                ['Address', identity.address], ['APN / Parcel', identity.apn], ['County', identity.county],
                ['State', identity.state], ['Owner', identity.owner], ['Acres', identity.acres],
                ['FIPS', identity.fips], ['LandPortal property ID', identity.landPortalPropertyId], ['Aliases', identity.parcelNotations],
              ].map(([label, item]) => (
                <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
                  <dt class="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</dt>
                  <dd class="mt-1 break-words text-sm">{value(item)}</dd>
                </div>
              ))}
            </dl>

            {result.facts.candidates && result.facts.candidates.length > 0 && (
              <div class="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
                <div class="font-semibold text-amber-200">Multiple credible candidates remain</div>
                {result.facts.candidates.map((candidate) => <div class="mt-2 text-sm">{value(candidate.apn)} · {value(candidate.county)}, {value(candidate.state)}</div>)}
              </div>
            )}

            {result.missingInformation.length > 0 && <div class="mt-4 text-sm"><b>Needed next:</b> {result.missingInformation.join('; ')}</div>}
            <div class="mt-5">
              <div class="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Evidence and provenance</div>
              {result.evidence.length === 0
                ? <div class="mt-2 text-sm text-[var(--color-text-muted)]">No source established the parcel. The result remains unresolved.</div>
                : <ul class="mt-2 space-y-2">{result.evidence.map((item) => <li class="text-sm"><b>{item.source}</b>{item.sourceType ? ` · ${item.sourceType.replace('_', ' ')}` : ''}<span class="text-[var(--color-text-muted)]"> · {item.retrievedAt}</span></li>)}</ul>}
            </div>
            <div class="mt-4 text-xs text-[var(--color-text-muted)]">Research session: {result.canonicalSubject?.id ?? 'not created'} · Invocation: {result.invocationId}</div>
          </section>
        )}

        {assessorError && <div class="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300" role="alert">{assessorError}</div>}

        {assessor && (
          <section class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5" data-testid="assessor-tax-result">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div class="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                  <Landmark size={14} /> Assessor &amp; Tax
                </div>
                <div class="mt-1 text-2xl font-semibold" data-testid="assessor-tax-status">{RECORD_STATUS_LABEL[assessor.facts.recordStatus]}</div>
                <div class="mt-1 text-sm text-[var(--color-text-muted)]">{assessor.facts.jurisdiction ?? 'Jurisdiction not established'}</div>
              </div>
              <div class="flex items-center gap-2">
                <div class="rounded-full border border-[var(--color-border)] px-3 py-1 text-xs text-[var(--color-text-muted)]">
                  {assessor.execution.reused ? 'Reused persisted result' : `${assessor.execution.mode} · ${assessor.execution.durationMs} ms`}
                </div>
                <button type="button" data-testid="assessor-tax-refresh" disabled={assessorRunning} onClick={() => void runAssessorTax(true)} class="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-semibold disabled:opacity-50">Refresh record</button>
              </div>
            </div>

            <p class="mt-3 text-sm leading-6 text-[var(--color-text-muted)]">{assessor.facts.summary}</p>

            <dl class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[
                ['Owner of record', assessor.facts.assessor.ownerOfRecord],
                ['Owner mailing address', assessor.facts.assessor.ownerMailingAddress],
                ['Situs address', assessor.facts.assessor.situsAddress],
                ['APN / Parcel', assessor.facts.assessor.apn],
                ['Assessed acreage', assessor.facts.assessor.assessedAcres],
                ['Land use class', assessor.facts.assessor.landUseClass],
                ['Appraised value (land)', assessor.facts.assessor.landAppraisedValue],
                ['Total appraised value', assessor.facts.assessor.totalAppraisedValue],
                ['Taxable value', assessor.facts.assessor.taxableValue],
                ['Annual property tax', assessor.facts.tax.annualTaxAmount],
                ['Tax year', assessor.facts.tax.taxYear],
                ['Tax standing', assessor.facts.tax.standingLabel],
                ['Improvement / structure', assessor.facts.improvements.structureType],
                ['Year built', assessor.facts.improvements.yearBuilt],
                ['Last recorded sale', assessor.facts.transfer.lastSaleDate],
              ].map(([label, item]) => (
                <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
                  <dt class="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</dt>
                  <dd class="mt-1 break-words text-sm">{value(item)}</dd>
                </div>
              ))}
            </dl>

            <div class="mt-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3 text-sm" data-testid="assessor-tax-standing">
              {String(assessor.facts.tax.statement ?? '')}
            </div>

            {assessor.facts.records.length > 0 && (
              <div class="mt-5" data-testid="assessor-tax-records">
                <div class="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Record fields retained</div>
                <ul class="mt-2 space-y-1">
                  {assessor.facts.records.map((record) => (
                    <li class="text-sm">
                      <b>{record.field}:</b> {record.value}
                      {record.source && <span class="text-[var(--color-text-muted)]"> · {record.source}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {assessor.missingInformation.length > 0 && <div class="mt-4 text-sm"><b>Not established:</b> {assessor.missingInformation.join('; ')}</div>}

            <div class="mt-5">
              <div class="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Evidence and provenance</div>
              {assessor.evidence.length === 0
                ? <div class="mt-2 text-sm text-[var(--color-text-muted)]">No assessor or tax source has been retrieved for this subject.</div>
                : <ul class="mt-2 space-y-2">{assessor.evidence.map((item) => <li class="text-sm"><b>{item.source}</b>{item.sourceType ? ` · ${item.sourceType.replace(/_/g, ' ')}` : ''}<span class="text-[var(--color-text-muted)]"> · {item.retrievedAt}</span></li>)}</ul>}
            </div>

            {assessor.facts.sourceAttempts.length > 0 && (
              <div class="mt-4 text-xs text-[var(--color-text-muted)]" data-testid="assessor-tax-attempts">
                <b>Sources attempted:</b> {assessor.facts.sourceAttempts.map((attempt) => `${attempt.source} — ${attempt.status}`).join('; ')}
              </div>
            )}

            <div class="mt-4 text-xs text-[var(--color-text-muted)]">Subject: {assessor.canonicalSubject?.id ?? 'not established'} · Invocation: {assessor.invocationId}</div>
          </section>
        )}

        {landPortalError && <div class="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300" role="alert">{landPortalError}</div>}

        {landPortal && (
          <section class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5" data-testid="landportal-research-result">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div class="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                  <Map size={14} /> LandPortal Research
                </div>
                <div class="mt-1 text-2xl font-semibold" data-testid="landportal-research-status">{LANDPORTAL_OUTCOME_LABEL[landPortal.facts.outcome]}</div>
                <div class="mt-1 text-sm text-[var(--color-text-muted)]">Subject {landPortal.subjectResolution}</div>
              </div>
              <div class="flex items-center gap-2">
                <div class="rounded-full border border-[var(--color-border)] px-3 py-1 text-xs text-[var(--color-text-muted)]">
                  {landPortal.execution.reused ? 'Reused persisted result' : `${landPortal.execution.mode} · ${landPortal.execution.durationMs} ms`}
                </div>
                <button type="button" data-testid="landportal-research-refresh" disabled={landPortalRunning} onClick={() => void runLandPortalResearch(true)} class="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-semibold disabled:opacity-50">Refresh record</button>
              </div>
            </div>

            <p class="mt-3 text-sm leading-6 text-[var(--color-text-muted)]">{landPortal.facts.summary}</p>

            <dl class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[
                ['APN / Parcel', parcel.apn], ['Situs address', parcel.situsAddress], ['Owner', parcel.owner],
                ['Acres', parcel.acres], ['Road frontage (ft)', parcel.roadFrontageFeet], ['Land locked', parcel.landLocked],
                ['Wetlands %', parcel.wetlandsPct], ['FEMA flood %', parcel.femaPct], ['Buildable acres', parcel.buildabilityAcres],
                ['Average slope (deg)', parcel.slopeAvgDegrees], ['Average elevation (ft)', parcel.elevationAvgFeet], ['Building area (sqft)', parcel.buildingAreaSqft],
                ['Land use', parcel.landUse], ['Assessed total', parcel.assessedTotal], ['Market total', parcel.marketTotal],
              ].map(([label, item]) => (
                <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
                  <dt class="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</dt>
                  <dd class="mt-1 break-words text-sm">{value(item)}</dd>
                </div>
              ))}
            </dl>

            {landPortal.facts.comparables.length > 0 && (
              <div class="mt-5" data-testid="landportal-research-comps">
                <div class="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">LandPortal comparable sales</div>
                <ul class="mt-2 space-y-1">
                  {landPortal.facts.comparables.map((comp) => (
                    <li class="text-sm">
                      {value(comp.location)} · {value(comp.saleYear)} · {value(comp.acres)} ac
                      {comp.pricePerAcre != null && <span class="text-[var(--color-text-muted)]"> · ${comp.pricePerAcre}/ac</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div class="mt-4 text-sm" data-testid="landportal-research-retained">
              <b>Retained LandPortal evidence:</b> {landPortal.facts.retained.parcelFactCount} parcel fact(s),{' '}
              {landPortal.facts.retained.assetCount} visual(s), {landPortal.facts.retained.comparableCount} comparable(s)
            </div>

            {landPortal.warnings.length > 0 && <div class="mt-4 text-sm"><b>Reported:</b> {landPortal.warnings.join('; ')}</div>}
            {landPortal.missingInformation.length > 0 && <div class="mt-4 text-sm"><b>Not established:</b> {landPortal.missingInformation.join('; ')}</div>}

            <div class="mt-5">
              <div class="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Evidence and provenance</div>
              {landPortal.evidence.length === 0
                ? <div class="mt-2 text-sm text-[var(--color-text-muted)]">No LandPortal source has been retrieved for this subject.</div>
                : <ul class="mt-2 space-y-2">{landPortal.evidence.map((item) => <li class="text-sm"><b>{item.source}</b>{item.sourceType ? ` · ${item.sourceType.replace(/_/g, ' ')}` : ''}<span class="text-[var(--color-text-muted)]"> · {item.retrievedAt}</span></li>)}</ul>}
            </div>

            {landPortal.facts.sourceAttempts.length > 0 && (
              <div class="mt-4 text-xs text-[var(--color-text-muted)]" data-testid="landportal-research-attempts">
                <b>Sources attempted:</b> {landPortal.facts.sourceAttempts.map((attempt) => `${attempt.source} — ${attempt.status}`).join('; ')}
              </div>
            )}

            <div class="mt-4 text-xs text-[var(--color-text-muted)]">Subject: {landPortal.canonicalSubject?.id ?? 'not established'} · Invocation: {landPortal.invocationId}</div>
          </section>
        )}

        {compsError && <div class="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300" role="alert">{compsError}</div>}

        {compsValuation && (
          <section class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5" data-testid="comps-valuation-result">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div class="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                  <Scale size={14} /> Comps &amp; Valuation
                </div>
                <div class="mt-1 text-2xl font-semibold" data-testid="comps-valuation-status">{COMPS_VALUATION_OUTCOME_LABEL[compsValuation.facts.outcome]}</div>
                <div class="mt-1 text-sm text-[var(--color-text-muted)]">
                  Subject {compsValuation.subjectResolution}
                  {compsValuation.facts.valuation ? ` · ${compsValuation.facts.valuation.statusLabel}` : ''}
                </div>
              </div>
              <div class="flex items-center gap-2">
                <div class="rounded-full border border-[var(--color-border)] px-3 py-1 text-xs text-[var(--color-text-muted)]">
                  {compsValuation.execution.reused ? 'Reused persisted result' : `${compsValuation.execution.mode} · ${compsValuation.execution.durationMs} ms`}
                </div>
                <button type="button" data-testid="comps-valuation-refresh" disabled={compsRunning} onClick={() => void runCompsValuation(true)} class="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-semibold disabled:opacity-50">Refresh valuation</button>
              </div>
            </div>

            <p class="mt-3 text-sm leading-6 text-[var(--color-text-muted)]">{compsValuation.facts.summary}</p>

            <dl class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[
                ['Land Value', usd(compsValuation.facts.split.landValue ?? compsValuation.facts.valuation?.landValue)] as [string, string],
                // The accepted acreage rule: the three components are reported
                // separately only for a subject of more than one acre.
                ...(compsValuation.facts.split.applies
                  ? [
                    ['House Value', usd(compsValuation.facts.split.houseValue)] as [string, string],
                    ['Whole Property Value', usd(compsValuation.facts.split.wholePropertyValue)] as [string, string],
                  ]
                  : []),
                ['Median $/acre', usd(compsValuation.facts.valuation?.medianPricePerAcre)] as [string, string],
                ['Weighted $/acre', usd(compsValuation.facts.valuation?.weightedPricePerAcre)] as [string, string],
                ['Supported retail range', compsValuation.facts.valuation?.retailRangeLow != null
                  ? `${usd(compsValuation.facts.valuation.retailRangeLow)} – ${usd(compsValuation.facts.valuation.retailRangeHigh)}`
                  : 'Not established'] as [string, string],
                ['Confidence', compsValuation.facts.valuation?.confidence ?? 'Not established'] as [string, string],
                ['Valuation set', `${compsValuation.facts.comps.valuationSetCount} closed sale(s), ${compsValuation.facts.valuation?.directCount ?? 0} direct`] as [string, string],
                ['Sale window', compsValuation.facts.valuation?.windowLabel ?? 'Not established'] as [string, string],
                ['Acquisition 40 / 50 / 60', compsValuation.facts.valuation?.acquisitionLevels
                  ? `${usd(compsValuation.facts.valuation.acquisitionLevels.pct40)} / ${usd(compsValuation.facts.valuation.acquisitionLevels.pct50)} / ${usd(compsValuation.facts.valuation.acquisitionLevels.pct60)}`
                  : 'Not established'] as [string, string],
              ].map(([label, item]) => (
                <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
                  <dt class="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</dt>
                  <dd class="mt-1 break-words text-sm">{item}</dd>
                </div>
              ))}
            </dl>

            <div class="mt-4 text-sm" data-testid="comps-valuation-split">{compsValuation.facts.split.why}</div>

            {compsValuation.facts.comps.selected.length > 0 && (
              <div class="mt-5" data-testid="comps-valuation-comps">
                <div class="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Comparables behind the result</div>
                <ul class="mt-2 space-y-1">
                  {compsValuation.facts.comps.selected.map((comp) => (
                    <li class="text-sm">
                      {value(comp.address)} · {value(comp.acres)} ac · {usd(comp.price)} ({comp.priceKind})
                      {comp.pricePerAcre != null && <span class="text-[var(--color-text-muted)]"> · {usd(comp.pricePerAcre)}/ac</span>}
                      {comp.distanceMiles != null && <span class="text-[var(--color-text-muted)]"> · {comp.distanceMiles} mi</span>}
                      <span class="text-[var(--color-text-muted)]"> · {comp.inValuationSet ? comp.valuationRole ?? 'in valuation set' : 'active competition'} · {comp.source}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div class="mt-4 text-sm" data-testid="comps-valuation-counts">
              <b>Comparable evidence:</b> {compsValuation.facts.comps.canonicalCount} canonical record(s),{' '}
              {compsValuation.facts.comps.valuationSetCount} pricing this subject, {compsValuation.facts.comps.activeCount} active competitor(s),{' '}
              {compsValuation.facts.comps.mapped} placed
              {compsValuation.facts.comps.unresolvedLocations > 0 && `, ${compsValuation.facts.comps.unresolvedLocations} location(s) unresolved`}
            </div>

            {compsValuation.warnings.length > 0 && <div class="mt-4 text-sm"><b>Reported:</b> {compsValuation.warnings.join('; ')}</div>}
            {compsValuation.missingInformation.length > 0 && <div class="mt-4 text-sm"><b>Not established:</b> {compsValuation.missingInformation.join('; ')}</div>}

            <div class="mt-5">
              <div class="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Evidence and provenance</div>
              {compsValuation.evidence.length === 0
                ? <div class="mt-2 text-sm text-[var(--color-text-muted)]">No comparable evidence is retained for this subject.</div>
                : <ul class="mt-2 space-y-2">{compsValuation.evidence.map((item) => <li class="text-sm"><b>{item.source}</b>{item.sourceType ? ` · ${item.sourceType.replace(/_/g, ' ')}` : ''}<span class="text-[var(--color-text-muted)]"> · {item.retrievedAt}</span></li>)}</ul>}
            </div>

            {compsValuation.facts.sourceAttempts.length > 0 && (
              <div class="mt-4 text-xs text-[var(--color-text-muted)]" data-testid="comps-valuation-attempts">
                <b>Providers behind the evidence:</b> {compsValuation.facts.sourceAttempts.map((attempt) => `${attempt.source} — ${attempt.status}`).join('; ')}
              </div>
            )}

            <div class="mt-4 text-xs text-[var(--color-text-muted)]">Subject: {compsValuation.canonicalSubject?.id ?? 'not established'} · Invocation: {compsValuation.invocationId}</div>
          </section>
        )}

        {zoningError && <div class="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300" role="alert">{zoningError}</div>}

        {zoning && (
          <section class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5" data-testid="zoning-subdivision-result">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div class="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                  <Ruler size={14} /> Zoning &amp; Subdivision
                </div>
                <div class="mt-1 text-2xl font-semibold" data-testid="zoning-subdivision-status">{ZONING_SUBDIVISION_OUTCOME_LABEL[zoning.facts.outcome]}</div>
                <div class="mt-1 text-sm text-[var(--color-text-muted)]">
                  Subject {zoning.subjectResolution}
                  {[zoning.facts.jurisdiction.municipality, zoning.facts.jurisdiction.county, zoning.facts.jurisdiction.state].filter(Boolean).length > 0
                    ? ` · ${[zoning.facts.jurisdiction.municipality, zoning.facts.jurisdiction.county, zoning.facts.jurisdiction.state].filter(Boolean).join(', ')}`
                    : ''}
                </div>
              </div>
              <div class="flex items-center gap-2">
                <div class="rounded-full border border-[var(--color-border)] px-3 py-1 text-xs text-[var(--color-text-muted)]">
                  {zoning.execution.reused ? 'Reused persisted result' : `${zoning.execution.mode} · ${zoning.execution.durationMs} ms`}
                </div>
                <button type="button" data-testid="zoning-subdivision-refresh" disabled={zoningRunning} onClick={() => void runZoningSubdivision(true)} class="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-semibold disabled:opacity-50">Refresh rules</button>
              </div>
            </div>

            <p class="mt-3 text-sm leading-6 text-[var(--color-text-muted)]">{zoning.facts.summary}</p>

            <dl class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[
                ['Zoning district', zoning.facts.zoning.established ? zoning.facts.zoning.districtCode : null],
                ['District name', zoning.facts.zoning.districtName],
                ['Zoning authority', zoning.facts.zoning.governingAuthority],
                ['Zoning confidence', zoning.facts.zoning.confidence],
                ['Incorporation', zoning.facts.jurisdiction.incorporationStatus],
                ['Rules retained', zoning.facts.rules.count ? `${zoning.facts.rules.count} from ${zoning.facts.rules.documentCount} document(s)` : null],
              ].map(([label, item]) => (
                <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
                  <dt class="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</dt>
                  <dd class="mt-1 break-words text-sm">{value(item)}</dd>
                </div>
              ))}
            </dl>

            {/* The by-right STATUS leads. A lot count never appears without it,
                because a number alone reads as an entitlement. */}
            <div class="mt-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3 text-sm" data-testid="zoning-subdivision-by-right">
              <b>Subdivision by right: {zoning.facts.subdivisionByRight.statusLabel}</b>
              {zoning.facts.subdivisionByRight.maximumLots != null && ` — up to ${zoning.facts.subdivisionByRight.maximumLots} lot(s)`}
              {zoning.facts.subdivisionByRight.reviewBody && ` · reviewed by ${zoning.facts.subdivisionByRight.reviewBody}`}
              <div class="mt-1 text-[var(--color-text-muted)]">{zoning.facts.subdivisionByRight.reason}</div>
              {zoning.facts.subdivisionByRight.constraintsApplied.length > 0 && (
                <div class="mt-1"><b>Constraints applied:</b> {zoning.facts.subdivisionByRight.constraintsApplied.map((row) => `${row.constraint} = ${row.value}`).join('; ')}</div>
              )}
              {zoning.facts.subdivisionByRight.missingInputs.length > 0 && (
                <div class="mt-1" data-testid="zoning-subdivision-missing-inputs"><b>Missing for a firm result:</b> {zoning.facts.subdivisionByRight.missingInputs.join('; ')}</div>
              )}
            </div>

            {zoning.facts.zoning.nonZoningClassification && (
              <div class="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm" data-testid="zoning-subdivision-non-zoning">
                <b>Not adopted zoning:</b> {zoning.facts.zoning.nonZoningClassification.code}
                {zoning.facts.zoning.nonZoningClassification.description ? ` — ${zoning.facts.zoning.nonZoningClassification.description}` : ''}.
                {' '}This is a classification the source published; it is not this parcel&#39;s zoning district.
              </div>
            )}

            {zoning.facts.zoning.historicalReferences.length > 0 && (
              <div class="mt-4 text-sm" data-testid="zoning-subdivision-historical">
                <b>Historical or requested districts (never the district in force today):</b>
                <ul class="mt-1 space-y-1">
                  {zoning.facts.zoning.historicalReferences.map((row) => (
                    <li>{row.kind.replace(/_/g, ' ')}: {value(row.value)}{row.asOf ? ` (as of ${row.asOf})` : ''}{row.sourceUrl && <> · <a class="underline" href={row.sourceUrl} target="_blank" rel="noreferrer">open source</a></>}</li>
                  ))}
                </ul>
              </div>
            )}

            {zoning.facts.rules.package.length > 0 && (
              <div class="mt-5" data-testid="zoning-subdivision-rules">
                <div class="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                  Jurisdiction rule package{zoning.facts.jurisdiction.rulePackageReused ? ' · reused for this jurisdiction' : ''}
                </div>
                <ul class="mt-2 space-y-1">
                  {zoning.facts.rules.package.map((rule) => (
                    <li class="text-sm">
                      <b>{rule.label}:</b> {rule.value ?? rule.unresolved ?? 'Not established'}
                      {rule.section && <span class="text-[var(--color-text-muted)]"> · {rule.section}</span>}
                      {rule.sourceUrl && <> · <a class="underline" href={rule.sourceUrl} target="_blank" rel="noreferrer">open source</a></>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {zoning.facts.sources.length > 0 && (
              <div class="mt-5" data-testid="zoning-subdivision-sources">
                <div class="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Authoritative sources</div>
                <ul class="mt-2 space-y-1">
                  {zoning.facts.sources.map((source) => (
                    <li class="text-sm">
                      {source.url
                        ? <a class="underline" href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
                        : source.title}
                      <span class="text-[var(--color-text-muted)]">{source.jurisdiction ? ` · ${source.jurisdiction}` : ''}{source.date ? ` · ${source.date}` : ''}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {zoning.warnings.length > 0 && <div class="mt-4 text-sm"><b>Reported:</b> {zoning.warnings.join('; ')}</div>}
            {zoning.missingInformation.length > 0 && <div class="mt-4 text-sm"><b>Not established:</b> {zoning.missingInformation.join('; ')}</div>}

            <div class="mt-4 text-xs text-[var(--color-text-muted)]">Subject: {zoning.canonicalSubject?.id ?? 'not established'} · Invocation: {zoning.invocationId}</div>
          </section>
        )}

        {historyError && <div class="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300" role="alert">{historyError}</div>}

        {history && (
          <section class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5" data-testid="property-development-history-result">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div class="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                  <History size={14} /> Property Development History
                </div>
                <div class="mt-1 text-2xl font-semibold" data-testid="property-development-history-status">{PROPERTY_HISTORY_OUTCOME_LABEL[history.facts.outcome]}</div>
                <div class="mt-1 text-sm text-[var(--color-text-muted)]">Subject {history.subjectResolution}</div>
              </div>
              <div class="flex items-center gap-2">
                <div class="rounded-full border border-[var(--color-border)] px-3 py-1 text-xs text-[var(--color-text-muted)]">
                  {history.execution.reused ? 'Reused persisted result' : `${history.execution.mode} · ${history.execution.durationMs} ms`}
                </div>
                <button type="button" data-testid="property-development-history-refresh" disabled={historyRunning} onClick={() => void runPropertyDevelopmentHistory(true)} class="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-semibold disabled:opacity-50">Refresh history</button>
              </div>
            </div>

            {/* Absence of a result is a valid result, and it is stated as what
                LandOS did not establish rather than as what does not exist. */}
            <p class="mt-3 text-sm leading-6 text-[var(--color-text-muted)]" data-testid="property-development-history-statement">
              {history.facts.history.statement}
            </p>
            {history.facts.history.narrative && <p class="mt-2 text-sm leading-6">{history.facts.history.narrative}</p>}

            {history.facts.history.events.length > 0 && (
              <ul class="mt-4 space-y-3" data-testid="property-development-history-events">
                {history.facts.history.events.map((event) => (
                  <li class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3 text-sm">
                    <div class="font-semibold">{event.eventDate ?? 'Date not stated'} — {event.projectName ?? event.eventTypeLabel}</div>
                    <div class="text-[var(--color-text-muted)]">{event.eventTypeLabel} · {event.statusLabel}{event.governingBody ? ` · ${event.governingBody}` : ''}</div>
                    {event.proposedLots != null && <div class="mt-1">{event.proposedLots} lot(s) proposed{event.acres != null ? ` on ${event.acres} acre(s)` : ''}</div>}
                    {/* Stated on its own line: a proposed lot count and an
                        entitled one are never the same claim. */}
                    <div class="mt-1" data-testid="property-history-entitlement">
                      Final entitlement status: Not established
                      {event.entitlementBasis ? ` — ${event.entitlementBasis}` : ''}
                    </div>
                    {event.applicant && <div class="mt-1">Applicant / developer: {event.applicant}</div>}
                    {event.ownerAtTheTime && <div>Owner of record at the time: {event.ownerAtTheTime}</div>}
                    <div class="mt-1">{event.summary}</div>
                    {event.sourceUrl && <div class="mt-1"><a class="underline" href={event.sourceUrl} target="_blank" rel="noreferrer">Open official record</a></div>}
                  </li>
                ))}
              </ul>
            )}

            {history.facts.relatedParties.length > 0 && (
              <div class="mt-5" data-testid="property-history-related-parties">
                <div class="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                  Related parties named in the record (context only — no CRM seller or contact is changed)
                </div>
                <ul class="mt-2 space-y-1">
                  {history.facts.relatedParties.map((party) => (
                    <li class="text-sm">
                      <b>{party.name}</b> — {party.roleLabel}
                      {party.sourceUrl && <> · <a class="underline" href={party.sourceUrl} target="_blank" rel="noreferrer">open source</a></>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {history.facts.sources.length > 0 && (
              <div class="mt-5" data-testid="property-history-sources">
                <div class="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Official sources</div>
                <ul class="mt-2 space-y-1">
                  {history.facts.sources.map((source) => (
                    <li class="text-sm">
                      {source.url
                        ? <a class="underline" href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
                        : source.title}
                      <span class="text-[var(--color-text-muted)]">{source.reusedFromStorage ? ' · already retained, nothing re-fetched' : ''}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div class="mt-4 text-xs text-[var(--color-text-muted)]" data-testid="property-history-search-note">
              {history.facts.search.note} Retained before searching: {history.facts.retainedContext.documentsHeld} document(s),{' '}
              {history.facts.retainedContext.findingsHeld} finding(s).
            </div>

            {history.warnings.length > 0 && <div class="mt-4 text-sm"><b>Reported:</b> {history.warnings.join('; ')}</div>}
            {history.facts.limitations.length > 0 && <div class="mt-2 text-sm"><b>Limitations:</b> {history.facts.limitations.join('; ')}</div>}

            <div class="mt-4 text-xs text-[var(--color-text-muted)]">Subject: {history.canonicalSubject?.id ?? 'not established'} · Invocation: {history.invocationId}</div>
          </section>
        )}
      </div>
    </div>
  );
}
