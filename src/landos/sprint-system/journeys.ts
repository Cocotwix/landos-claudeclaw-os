// LandOS Sprint System — Golden Operator Journeys.
//
// Reusable acceptance journeys for core LandOS operator states. These are
// acceptance fixtures and workflows — never hardcoded production fixes and
// never bound to a single property. Journeys that would create or modify
// operator data are marked mutating and are refused by default; the runner
// only exercises them when explicitly allowed against safe fixtures.
// Journeys select their subject at run time by criteria; when no safe fixture
// matches, the journey reports fixture_unavailable instead of fabricating a
// pass. External provider success is NEVER fabricated in production code.

export type CardCriteria =
  | 'any'
  | 'verified_strong_evidence'
  | 'verified_incomplete_research'
  | 'unresolved'
  | 'apn_conflict'
  | 'acreage_conflict'
  | 'strong_comps'
  | 'thin_comps'
  | 'provider_fallback'
  | 'multi_parcel';

export type JourneyStep =
  | { kind: 'select_card'; criteria: CardCriteria; description: string }
  | { kind: 'navigate'; path: string; description: string }
  | { kind: 'expect_text'; anyOf: string[]; description: string }
  | { kind: 'forbid_text'; anyOf: string[]; description: string }
  | { kind: 'expect_test_id'; testId: string; count?: number; description: string }
  | { kind: 'forbid_test_id'; testId: string; description: string }
  | { kind: 'set_viewport'; width: number; height: number; description: string }
  | { kind: 'click_text'; text: string; description: string; optional?: boolean }
  | { kind: 'screenshot'; name: string; description: string }
  | {
      kind: 'api_reconcile';
      apiPath: string;
      extract?: string;
      expectOnPage?: boolean;
      description: string;
    }
  | { kind: 'refresh_persistence'; expectAnyOf: string[]; expectTestId?: string; description: string }
  | { kind: 'restart_persistence'; expectAnyOf: string[]; description: string }
  | { kind: 'manual'; description: string };

export interface GoldenJourney {
  id: string;
  name: string;
  capability: string;
  department: string;
  startingState: string;
  operatorSteps: JourneyStep[];
  expectedBackendState: string;
  expectedFrontendState: string;
  prohibitedContradictions: string[];
  requiredScreenshots: string[];
  persistence: { refresh: boolean; restart: boolean };
  allowedExternalBlockers: string[];
  passCriteria: string;
  failureCriteria: string;
  /** True when running the journey would create or modify operator data. */
  mutating: boolean;
  /** Real records may be used only where safe; otherwise prefer stable fixtures. */
  fixturePolicy: string;
}

const DEAL_LIST_PATH = '/landos';
const DEAL_PATH = '/landos?deal={dealId}';
const LEAD_WORKSPACE_PATH = '/dept/acquisitions?deal={dealId}';

function dealCardShell(criteria: CardCriteria, shot: string): JourneyStep[] {
  return [
    { kind: 'select_card', criteria, description: `Select a deal card matching criteria: ${criteria}` },
    { kind: 'navigate', path: DEAL_LIST_PATH, description: 'Open the LandOS operator workspace' },
    { kind: 'expect_text', anyOf: ['LandOS', 'Deal'], description: 'Workspace shell renders' },
    { kind: 'navigate', path: DEAL_PATH, description: 'Open the selected Deal Card' },
    { kind: 'screenshot', name: shot, description: 'Capture the opened Deal Card' },
  ];
}

export const GOLDEN_JOURNEYS: GoldenJourney[] = [
  {
    id: 'lead-workspace-acquisitions-readonly',
    name: 'Lead Workspace through Acquisitions',
    capability: 'lead-workspace',
    department: 'acquisitions',
    startingState: 'An existing safe deal-card fixture selected without modifying operator data.',
    operatorSteps: [
      { kind: 'select_card', criteria: 'any', description: 'Select an existing safe Lead Workspace fixture' },
      { kind: 'navigate', path: LEAD_WORKSPACE_PATH, description: 'Open the Lead Workspace from the Acquisitions deep link' },
      { kind: 'expect_test_id', testId: 'lead-workspace-root', count: 1, description: 'The Lead Workspace root is present exactly once' },
      { kind: 'api_reconcile', apiPath: '/api/landos/lead-workspace/{dealId}', description: 'Lead Workspace API responds for the selected fixture' },
      { kind: 'expect_test_id', testId: 'lead-workspace-strategy', count: 5, description: 'Exactly the five approved strategies are rendered' },
      { kind: 'forbid_test_id', testId: 'deal-card-root', description: 'The legacy DealCard root is absent from the Lead Workspace' },
      { kind: 'screenshot', name: 'lead-workspace-desktop', description: 'Capture the desktop Lead Workspace' },
      { kind: 'refresh_persistence', expectAnyOf: [], expectTestId: 'lead-workspace-root', description: 'Reload and confirm the Lead Workspace remains available' },
      { kind: 'set_viewport', width: 412, height: 915, description: 'Use a Galaxy S24 Ultra-width mobile viewport' },
      { kind: 'expect_test_id', testId: 'lead-workspace-root', count: 1, description: 'The Lead Workspace root remains available on mobile' },
      { kind: 'expect_test_id', testId: 'lead-workspace-strategy', count: 5, description: 'All five approved strategies remain available on mobile' },
      { kind: 'screenshot', name: 'lead-workspace-mobile', description: 'Capture the mobile Lead Workspace' },
    ],
    expectedBackendState: 'The versioned lead-workspace API returns the composed read model for the selected fixture.',
    expectedFrontendState: 'Acquisitions renders the Lead Workspace, not the legacy DealCard, with exactly five approved strategies on desktop and mobile.',
    prohibitedContradictions: ['Lead Workspace root missing', 'Legacy DealCard root rendered in the new flow', 'Strategy count differs from the approved five'],
    requiredScreenshots: ['lead-workspace-desktop', 'lead-workspace-mobile'],
    persistence: { refresh: true, restart: false },
    allowedExternalBlockers: [],
    passCriteria: 'The read-only Acquisitions deep link, API, semantic roots, approved strategy count, refresh, and mobile viewport all pass.',
    failureCriteria: 'Missing workspace/API, a legacy DealCard root, a strategy count other than five, or failed refresh/mobile rendering.',
    mutating: false,
    fixturePolicy: 'Read-only against a dynamically selected existing deal-card fixture; never creates or updates an operator record.',
  },
  {
    id: 'verified-property-strong-evidence',
    name: 'Existing verified property with strong evidence',
    capability: 'deal-card',
    department: 'acquisitions',
    startingState: 'A deal card whose resolution is verified with multiple evidence sources.',
    operatorSteps: [
      ...dealCardShell('verified_strong_evidence', 'verified-strong-card'),
      { kind: 'api_reconcile', apiPath: '/api/landos/deal-cards/{dealId}', description: 'Deal Card API responds and matches the visible card' },
      { kind: 'forbid_text', anyOf: ['undefined', 'NaN', '[object Object]'], description: 'No raw placeholder values visible' },
    ],
    expectedBackendState: 'Deal card API returns the verified resolution with evidence records.',
    expectedFrontendState: 'Card shows verified status, evidence, and no contradictions across tabs.',
    prohibitedContradictions: ['Readiness contradicts blockers', 'Tabs disagree on APN or acreage'],
    requiredScreenshots: ['verified-strong-card'],
    persistence: { refresh: true, restart: false },
    allowedExternalBlockers: [],
    passCriteria: 'Verified evidence visible in browser and consistent with the API.',
    failureCriteria: 'Missing evidence, contradictions, placeholder values, or API/frontend divergence.',
    mutating: false,
    fixturePolicy: 'Read-only against an existing verified card; no record is modified.',
  },
  {
    id: 'verified-property-incomplete-research',
    name: 'Existing verified property with incomplete research',
    capability: 'deal-card',
    department: 'acquisitions',
    startingState: 'A verified deal card whose research is honestly incomplete.',
    operatorSteps: [
      ...dealCardShell('verified_incomplete_research', 'incomplete-research-card'),
      { kind: 'forbid_text', anyOf: ['research complete', 'fully researched'], description: 'No misleading favorable language while research is incomplete' },
    ],
    expectedBackendState: 'Research/DD records show open items.',
    expectedFrontendState: 'The card states plainly what is missing; no complete-sounding language.',
    prohibitedContradictions: ['A complete report with missing research', 'Favorable summary language contradicting open DD items'],
    requiredScreenshots: ['incomplete-research-card'],
    persistence: { refresh: true, restart: false },
    allowedExternalBlockers: [],
    passCriteria: 'Incomplete research is visibly and honestly disclosed.',
    failureCriteria: 'Complete-sounding language while research items remain open.',
    mutating: false,
    fixturePolicy: 'Read-only; select any card with open research items.',
  },
  {
    id: 'existing-unresolved-property',
    name: 'Existing unresolved property',
    capability: 'property-resolution',
    department: 'acquisitions',
    startingState: 'A deal card whose property resolution is unresolved.',
    operatorSteps: [
      ...dealCardShell('unresolved', 'unresolved-card'),
      { kind: 'expect_text', anyOf: ['unresolved', 'Unresolved', 'needs', 'conflict'], description: 'Unresolved state is visible to the operator' },
      { kind: 'forbid_text', anyOf: ['verified'], description: 'An unresolved card must not present itself as verified' },
    ],
    expectedBackendState: 'Resolution API reports unresolved with reasons.',
    expectedFrontendState: 'The card honestly shows unresolved status and what is needed.',
    prohibitedContradictions: ['Unresolved backend state shown as verified in the UI'],
    requiredScreenshots: ['unresolved-card'],
    persistence: { refresh: true, restart: false },
    allowedExternalBlockers: [],
    passCriteria: 'Unresolved status visible with reasons.',
    failureCriteria: 'Unresolved card renders as verified or hides its blockers.',
    mutating: false,
    fixturePolicy: 'Read-only against an existing unresolved card.',
  },
  {
    id: 'new-property-resolves',
    name: 'Brand-new property that resolves successfully',
    capability: 'intake-resolution',
    department: 'acquisitions',
    startingState: 'A safe fixture address that the resolution engine can resolve.',
    operatorSteps: [
      { kind: 'manual', description: 'Submit a clearly-labeled QA fixture address through the intake flow (creates a record; requires explicit mutation approval)' },
      { kind: 'expect_text', anyOf: ['verified', 'resolved'], description: 'Resolution result visible' },
      { kind: 'screenshot', name: 'new-property-resolved', description: 'Capture the resolved card' },
    ],
    expectedBackendState: 'A new property and deal card exist with a successful resolution.',
    expectedFrontendState: 'The new card is visible with resolution evidence.',
    prohibitedContradictions: ['Resolution succeeds in API but card missing in UI'],
    requiredScreenshots: ['new-property-resolved'],
    persistence: { refresh: true, restart: true },
    allowedExternalBlockers: ['County/provider endpoints unavailable'],
    passCriteria: 'New fixture property resolves and is visible after refresh and restart.',
    failureCriteria: 'Card missing, resolution invisible, or data lost after refresh/restart.',
    mutating: true,
    fixturePolicy: 'Only a clearly-labeled QA fixture address; never a real seller record.',
  },
  {
    id: 'new-property-honestly-unresolved',
    name: 'Brand-new property that honestly remains unresolved',
    capability: 'intake-resolution',
    department: 'acquisitions',
    startingState: 'A safe fixture address designed not to resolve.',
    operatorSteps: [
      { kind: 'manual', description: 'Submit a QA fixture address that cannot resolve (requires explicit mutation approval)' },
      { kind: 'expect_text', anyOf: ['unresolved', 'could not', 'needs'], description: 'Honest unresolved outcome visible' },
      { kind: 'forbid_text', anyOf: ['verified'], description: 'No fabricated resolution' },
      { kind: 'screenshot', name: 'new-property-unresolved', description: 'Capture the honest unresolved state' },
    ],
    expectedBackendState: 'The record exists with an unresolved resolution and honest reasons.',
    expectedFrontendState: 'UI shows unresolved with what is missing; no invented facts.',
    prohibitedContradictions: ['Fabricated provider success', 'Unresolved backend shown as verified'],
    requiredScreenshots: ['new-property-unresolved'],
    persistence: { refresh: true, restart: false },
    allowedExternalBlockers: [],
    passCriteria: 'Honest unresolved outcome, visibly explained.',
    failureCriteria: 'Any fabricated success.',
    mutating: true,
    fixturePolicy: 'QA fixture address only.',
  },
  {
    id: 'genuine-apn-conflict',
    name: 'Genuine APN conflict',
    capability: 'property-resolution',
    department: 'acquisitions',
    startingState: 'A deal card with a genuine APN conflict between sources.',
    operatorSteps: [
      ...dealCardShell('apn_conflict', 'apn-conflict-card'),
      { kind: 'expect_text', anyOf: ['APN', 'apn'], description: 'APN information is visible' },
      { kind: 'expect_text', anyOf: ['conflict', 'Conflict', 'mismatch'], description: 'The conflict is disclosed, not hidden' },
    ],
    expectedBackendState: 'Resolution stores both candidate APNs with sources.',
    expectedFrontendState: 'Conflict is visible and routed to the operator for a decision.',
    prohibitedContradictions: ['One APN silently chosen without disclosure'],
    requiredScreenshots: ['apn-conflict-card'],
    persistence: { refresh: true, restart: false },
    allowedExternalBlockers: [],
    passCriteria: 'Conflict disclosed with both candidates and sources.',
    failureCriteria: 'Conflict hidden or silently auto-resolved.',
    mutating: false,
    fixturePolicy: 'Read-only against an existing conflicted card.',
  },
  {
    id: 'acreage-conflict-requires-tyler',
    name: 'Acreage conflict requiring Tyler',
    capability: 'property-resolution',
    department: 'acquisitions',
    startingState: 'A deal card whose sources disagree on acreage beyond tolerance.',
    operatorSteps: [
      ...dealCardShell('acreage_conflict', 'acreage-conflict-card'),
      { kind: 'expect_text', anyOf: ['acre', 'Acre'], description: 'Acreage is visible' },
      { kind: 'expect_text', anyOf: ['conflict', 'Conflict', 'review', 'confirm'], description: 'The conflict requests operator confirmation' },
    ],
    expectedBackendState: 'Both acreage values retained with sources; decision pending.',
    expectedFrontendState: 'Card asks Tyler to confirm; no silent override of accepted data.',
    prohibitedContradictions: ['Previously accepted operator acreage changed without confirmation'],
    requiredScreenshots: ['acreage-conflict-card'],
    persistence: { refresh: true, restart: false },
    allowedExternalBlockers: [],
    passCriteria: 'Conflict routed to Tyler; accepted data unchanged.',
    failureCriteria: 'Silent acreage change or hidden conflict.',
    mutating: false,
    fixturePolicy: 'Read-only.',
  },
  {
    id: 'strong-comp-market',
    name: 'Strong comp market',
    capability: 'comparable-intelligence',
    department: 'market',
    startingState: 'A deal card with a healthy set of comparable sales.',
    operatorSteps: [
      ...dealCardShell('strong_comps', 'strong-comps-card'),
      { kind: 'api_reconcile', apiPath: '/api/landos/deal-cards/{dealId}/comps', description: 'Comps API returns records that appear in the visible card' },
      { kind: 'expect_text', anyOf: ['/ac', 'per acre', '$'], description: 'Price-per-acre values are present' },
      { kind: 'screenshot', name: 'strong-comps-detail', description: 'Capture the comps section' },
    ],
    expectedBackendState: 'Comps stored with prices, acreage, and price-per-acre.',
    expectedFrontendState: 'Comps table/map visible with per-acre values and working provider links.',
    prohibitedContradictions: ['Comp totals differing between tabs', 'Duplicate comp records'],
    requiredScreenshots: ['strong-comps-card', 'strong-comps-detail'],
    persistence: { refresh: true, restart: false },
    allowedExternalBlockers: [],
    passCriteria: 'Comps visible, priced per acre, consistent with API.',
    failureCriteria: 'Missing per-acre values, duplicates, broken links or maps.',
    mutating: false,
    fixturePolicy: 'Read-only.',
  },
  {
    id: 'thin-comp-market',
    name: 'Thin comp market',
    capability: 'comparable-intelligence',
    department: 'market',
    startingState: 'A deal card in a market with few or no comps.',
    operatorSteps: [
      ...dealCardShell('thin_comps', 'thin-comps-card'),
      { kind: 'forbid_text', anyOf: ['strong market', 'high confidence'], description: 'No unsupported valuation confidence in a thin market' },
    ],
    expectedBackendState: 'Comp search recorded with few results and honest confidence.',
    expectedFrontendState: 'Card discloses thin data; valuation language is guarded.',
    prohibitedContradictions: ['Unsupported valuations or confident conclusions from thin data'],
    requiredScreenshots: ['thin-comps-card'],
    persistence: { refresh: true, restart: false },
    allowedExternalBlockers: [],
    passCriteria: 'Thin data disclosed honestly.',
    failureCriteria: 'Confident valuation unsupported by comp evidence.',
    mutating: false,
    fixturePolicy: 'Read-only.',
  },
  {
    id: 'provider-failure-fallback',
    name: 'Provider failure with successful fallback',
    capability: 'provider-orchestration',
    department: 'research',
    startingState: 'A deal card where a primary provider failed and a fallback supplied evidence.',
    operatorSteps: [
      ...dealCardShell('provider_fallback', 'provider-fallback-card'),
      { kind: 'expect_text', anyOf: ['fallback', 'source', 'provider'], description: 'Provider evidence and sourcing are visible' },
    ],
    expectedBackendState: 'Provider attempts recorded: primary failure, fallback success.',
    expectedFrontendState: 'Evidence shows its true source; no fabricated primary success.',
    prohibitedContradictions: ['Missing provider evidence', 'Fabricated provider success'],
    requiredScreenshots: ['provider-fallback-card'],
    persistence: { refresh: true, restart: false },
    allowedExternalBlockers: ['All providers genuinely down'],
    passCriteria: 'True provenance visible.',
    failureCriteria: 'Provider evidence missing or misattributed.',
    mutating: false,
    fixturePolicy: 'Read-only.',
  },
  {
    id: 'multi-parcel-property',
    name: 'Multi-parcel property',
    capability: 'property-resolution',
    department: 'acquisitions',
    startingState: 'A deal card representing a property with multiple parcels.',
    operatorSteps: [
      ...dealCardShell('multi_parcel', 'multi-parcel-card'),
      { kind: 'expect_text', anyOf: ['parcel', 'Parcel'], description: 'Parcel breakdown is visible' },
    ],
    expectedBackendState: 'All parcels persisted and associated with the card.',
    expectedFrontendState: 'Every parcel visible; totals correct; second parcel survives refresh.',
    prohibitedContradictions: ['Second parcel missing after refresh or restart', 'Incorrect acreage totals'],
    requiredScreenshots: ['multi-parcel-card'],
    persistence: { refresh: true, restart: true },
    allowedExternalBlockers: [],
    passCriteria: 'All parcels visible and persistent.',
    failureCriteria: 'A parcel disappears or totals are wrong.',
    mutating: false,
    fixturePolicy: 'Read-only.',
  },
  {
    id: 'refresh-persistence',
    name: 'Refresh persistence',
    capability: 'platform',
    department: 'platform',
    startingState: 'Any existing deal card.',
    operatorSteps: [
      ...dealCardShell('any', 'refresh-before'),
      { kind: 'refresh_persistence', expectAnyOf: ['LandOS', 'Deal'], description: 'Reload the browser and confirm the same card and data remain' },
      { kind: 'screenshot', name: 'refresh-after', description: 'Capture the card after refresh' },
    ],
    expectedBackendState: 'Unchanged by a browser refresh.',
    expectedFrontendState: 'Identical operator data before and after refresh.',
    prohibitedContradictions: ['Data disappearing after refresh'],
    requiredScreenshots: ['refresh-before', 'refresh-after'],
    persistence: { refresh: true, restart: false },
    allowedExternalBlockers: [],
    passCriteria: 'Card data survives refresh.',
    failureCriteria: 'Any visible data loss on refresh.',
    mutating: false,
    fixturePolicy: 'Read-only.',
  },
  {
    id: 'managed-restart-persistence',
    name: 'Managed restart persistence',
    capability: 'platform',
    department: 'platform',
    startingState: 'Any existing deal card; managed runtime healthy.',
    operatorSteps: [
      ...dealCardShell('any', 'restart-before'),
      { kind: 'restart_persistence', expectAnyOf: ['LandOS', 'Deal'], description: 'Restart LandOS through the managed runtime, reopen the workflow, confirm data remains' },
      { kind: 'screenshot', name: 'restart-after', description: 'Capture the card after managed restart' },
    ],
    expectedBackendState: 'All records intact after npm run landos:restart.',
    expectedFrontendState: 'Same card and data visible after restart.',
    prohibitedContradictions: ['Data disappearing after restart'],
    requiredScreenshots: ['restart-before', 'restart-after'],
    persistence: { refresh: false, restart: true },
    allowedExternalBlockers: [],
    passCriteria: 'Card data survives a managed restart.',
    failureCriteria: 'Any visible data loss after restart.',
    mutating: false,
    fixturePolicy: 'Read-only; restart uses only the managed runtime commands.',
  },
  {
    id: 'dashboard-shell-health',
    name: 'Dashboard shell and API health',
    capability: 'platform',
    department: 'platform',
    startingState: 'Managed runtime healthy; no card required.',
    operatorSteps: [
      { kind: 'navigate', path: DEAL_LIST_PATH, description: 'Open the LandOS workspace' },
      { kind: 'expect_text', anyOf: ['LandOS', 'Deal', 'Board'], description: 'Workspace shell renders' },
      { kind: 'api_reconcile', apiPath: '/api/landos/deal-cards', description: 'Deal-cards API responds' },
      { kind: 'screenshot', name: 'dashboard-shell', description: 'Capture the workspace shell' },
    ],
    expectedBackendState: 'Health and deal-cards APIs respond 200.',
    expectedFrontendState: 'Workspace shell renders without errors.',
    prohibitedContradictions: ['API healthy while the visible dashboard is broken'],
    requiredScreenshots: ['dashboard-shell'],
    persistence: { refresh: true, restart: false },
    allowedExternalBlockers: [],
    passCriteria: 'Live dashboard renders and reconciles with its API.',
    failureCriteria: 'Shell fails to render or APIs disagree with the page.',
    mutating: false,
    fixturePolicy: 'Read-only.',
  },
];

export function getJourney(id: string): GoldenJourney {
  const journey = GOLDEN_JOURNEYS.find((j) => j.id === id);
  if (!journey) throw new Error(`unknown golden journey ${id}`);
  return journey;
}

export function journeysForCapability(capability: string): GoldenJourney[] {
  return GOLDEN_JOURNEYS.filter((j) => j.capability === capability);
}

export function journeysForDepartment(department: string): GoldenJourney[] {
  return GOLDEN_JOURNEYS.filter((j) => j.department === department);
}

export function validateJourney(journey: GoldenJourney): string[] {
  const problems: string[] = [];
  if (!journey.operatorSteps.length) problems.push(`${journey.id}: no operator steps`);
  if (!journey.startingState.trim()) problems.push(`${journey.id}: missing starting state`);
  if (!journey.expectedBackendState.trim()) problems.push(`${journey.id}: missing expected backend state`);
  if (!journey.expectedFrontendState.trim()) problems.push(`${journey.id}: missing expected frontend state`);
  if (!journey.passCriteria.trim() || !journey.failureCriteria.trim()) {
    problems.push(`${journey.id}: missing pass/failure criteria`);
  }
  const shots = journey.operatorSteps.filter((s) => s.kind === 'screenshot').map((s) => (s as { name: string }).name);
  for (const required of journey.requiredScreenshots) {
    if (!shots.includes(required)) problems.push(`${journey.id}: required screenshot ${required} has no capturing step`);
  }
  return problems;
}
