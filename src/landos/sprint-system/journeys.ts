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
  | 'quarantined_research'
  | 'investigative_path_plan'
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
  | { kind: 'click_test_id'; testId: string; description: string; optional?: boolean }
  | { kind: 'fill_test_id'; testId: string; value: string; description: string }
  | { kind: 'upload_text_test_id'; testId: string; fileName: string; content: string; description: string }
  | { kind: 'screenshot'; name: string; description: string }
  | {
      kind: 'api_reconcile';
      apiPath: string;
      extract?: string;
      expectOnPage?: boolean;
      description: string;
    }
  | { kind: 'refresh_persistence'; expectAnyOf: string[]; expectTestId?: string; description: string }
  | { kind: 'restart_persistence'; expectAnyOf: string[]; expectTestId?: string; description: string }
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
// Canonical Acquisitions deep link. Since the accepted recovery merge
// (PR #2, 2026-07-23) this path renders the canonical Deal Card; the legacy
// Lead Workspace view is retired and must never render.
const ACQUISITIONS_DEAL_PATH = '/dept/acquisitions?deal={dealId}';

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
    id: 'ws1-operator-opportunity-board',
    name: 'Canonical opportunity board and recoverable Trash visibility',
    capability: 'operator-opportunity-board',
    department: 'acquisitions',
    startingState: 'Fresh production build with at least one active opportunity and an existing safe Lead Workspace fixture.',
    operatorSteps: [
      { kind: 'select_card', criteria: 'any', description: 'Select an existing safe opportunity workspace fixture' },
      { kind: 'navigate', path: '/dept/acquisitions', description: 'Open the live Acquisitions Pipeline' },
      { kind: 'expect_test_id', testId: 'opportunity-board', count: 1, description: 'Exactly one canonical board surface is rendered' },
      { kind: 'expect_test_id', testId: 'opportunity-lane-new_lead', count: 1, description: 'The owner-facing New Leads lane is rendered once' },
      { kind: 'expect_test_id', testId: 'opportunity-lane-discovery_ready', count: 1, description: 'The owner-facing Ready for Discovery Call lane is rendered once' },
      { kind: 'forbid_text', anyOf: ['needs parcel verification', 'needs seller discovery'], description: 'Technical research states are not board lanes' },
      { kind: 'screenshot', name: 'ws1-opportunity-board', description: 'Capture the business-stage opportunity board' },
      { kind: 'refresh_persistence', expectAnyOf: ['New Leads', 'Researching', 'Ready for Discovery Call', 'Pursuing'], expectTestId: 'opportunity-board', description: 'The canonical board survives refresh' },
      { kind: 'restart_persistence', expectAnyOf: ['New Leads', 'Researching', 'Ready for Discovery Call', 'Pursuing'], expectTestId: 'opportunity-board', description: 'The canonical board survives a managed restart' },
      { kind: 'navigate', path: ACQUISITIONS_DEAL_PATH, description: 'Open the selected canonical Lead Workspace' },
      { kind: 'expect_test_id', testId: 'lead-trash-action', count: 1, description: 'The owner-visible recoverable Trash action is present' },
      { kind: 'screenshot', name: 'ws1-lead-trash-action', description: 'Capture the visible recoverable Trash action' },
    ],
    expectedBackendState: 'One active board row is projected per canonical opportunity; soft-deleted Deal Card aliases are excluded and remain restorable.',
    expectedFrontendState: 'The owner sees business stages, one card per opportunity, research context on the card, and a visible recoverable Trash action.',
    prohibitedContradictions: ['Technical parcel/research lanes', 'Duplicate board placement for one opportunity', 'Missing Trash action'],
    requiredScreenshots: ['ws1-opportunity-board', 'ws1-lead-trash-action'],
    persistence: { refresh: true, restart: true },
    allowedExternalBlockers: [],
    passCriteria: 'The live canonical board, business labels, visible Trash action, refresh, and managed restart assertions pass.',
    failureCriteria: 'Missing board/card/action, technical lane text, duplicate canonical surface, or failed refresh/restart.',
    mutating: false,
    fixturePolicy: 'Read-only against current active opportunities; the separate isolated browser journey exercises Trash and Restore mutations.',
  },
  {
    id: 'ws2-investigative-intake-mission',
    name: 'Investigative intake and multi-path parcel resolution',
    capability: 'investigative-intake-mission',
    department: 'acquisitions',
    startingState: 'An existing partial lead with a durable research mission and the bounded investigative path plan.',
    operatorSteps: [
      { kind: 'select_card', criteria: 'investigative_path_plan', description: 'Select a lead whose durable mission contains the complete investigative path plan' },
      { kind: 'navigate', path: ACQUISITIONS_DEAL_PATH, description: 'Open the partial lead in the live Lead Workspace' },
      { kind: 'expect_test_id', testId: 'original-lead-intake', count: 1, description: 'The exact original operator data dump remains visible' },
      { kind: 'expect_test_id', testId: 'research-trace-toggle', count: 1, description: 'The visible research and verification trace is available' },
      { kind: 'click_test_id', testId: 'research-trace-toggle', description: 'Expand the owner-visible investigative trace' },
      { kind: 'expect_test_id', testId: 'research-path-apn_variants', count: 1, description: 'Exact-digit APN variants are planned once' },
      { kind: 'expect_test_id', testId: 'research-path-landportal_browser', count: 1, description: 'LandPortal is present as a browser-only research workspace' },
      { kind: 'expect_test_id', testId: 'research-path-county_gis', count: 1, description: 'County GIS is an independent resolution path' },
      { kind: 'expect_test_id', testId: 'research-path-county_assessor', count: 1, description: 'County assessor is an independent resolution path' },
      { kind: 'expect_test_id', testId: 'research-path-county_recorder', count: 1, description: 'County recorder is an independent resolution path' },
      { kind: 'expect_test_id', testId: 'research-path-web_search', count: 1, description: 'General web search is an independent research path' },
      { kind: 'expect_test_id', testId: 'research-path-zillow', count: 1, description: 'Zillow is a non-authoritative discovery path' },
      { kind: 'expect_test_id', testId: 'research-path-redfin', count: 1, description: 'Redfin is a non-authoritative discovery path' },
      { kind: 'expect_test_id', testId: 'discovery-call-guardrail', count: 1, description: 'Incomplete parcel resolution does not block seller discovery' },
      { kind: 'forbid_text', anyOf: ['LandPortal is authoritative', 'Buy paid report', 'Use comp credit', 'Send offer', 'Send contract'], description: 'No terminal-provider, paid, or prohibited outbound action is offered' },
      { kind: 'screenshot', name: 'ws2-investigative-paths', description: 'Capture the visible multi-path investigative plan' },
      { kind: 'refresh_persistence', expectAnyOf: [], expectTestId: 'research-trace-toggle', description: 'The durable investigative mission survives refresh' },
      { kind: 'restart_persistence', expectAnyOf: [], expectTestId: 'research-trace-toggle', description: 'The durable investigative mission survives a managed restart' },
    ],
    expectedBackendState: 'The original partial intake and bounded multi-path research plan are durable; APN variants retain the exact digit sequence.',
    expectedFrontendState: 'The owner can inspect every research path, with LandPortal clearly non-authoritative and discovery still available.',
    prohibitedContradictions: ['LandPortal as an authority or terminal gate', 'Changed APN digits', 'Paid action', 'Seller outbound', 'Blocked discovery call'],
    requiredScreenshots: ['ws2-investigative-paths'],
    persistence: { refresh: true, restart: true },
    allowedExternalBlockers: ['Public provider unavailable or access blocked, with the attempt recorded truthfully'],
    passCriteria: 'The live workspace visibly preserves intake, exposes all planned paths, retains discovery access, and survives refresh and restart.',
    failureCriteria: 'Missing intake/path, terminal-provider language, prohibited action, blocked discovery, or failed persistence.',
    mutating: false,
    fixturePolicy: 'Read-only against the isolated partial lead created through the owner-visible intake workflow.',
  },
  {
    id: 'ws3-visible-discovery-package',
    name: 'Visible evidence-backed discovery-call package',
    capability: 'visible-discovery-package',
    department: 'acquisitions',
    startingState: 'An existing partial lead with a durable investigative mission and a current discovery package.',
    operatorSteps: [
      { kind: 'select_card', criteria: 'investigative_path_plan', description: 'Select the durable partial-lead fixture from WS2' },
      { kind: 'navigate', path: ACQUISITIONS_DEAL_PATH, description: 'Open the Lead Workspace in the managed operating app' },
      { kind: 'expect_test_id', testId: 'discovery-package-entry', count: 1, description: 'One obvious pre-discovery report entry point is visible on the Lead Card' },
      { kind: 'click_test_id', testId: 'discovery-package-entry', description: 'Open the pre-discovery research report' },
      { kind: 'expect_test_id', testId: 'discovery-package', count: 1, description: 'Exactly one current report is rendered' },
      { kind: 'expect_test_id', testId: 'discovery-package-readiness', count: 1, description: 'Evidence-threshold readiness is explicit' },
      { kind: 'expect_test_id', testId: 'discovery-package-blockers', count: 1, description: 'Exact research gaps remain visible' },
      { kind: 'expect_test_id', testId: 'discovery-package-visuals', count: 1, description: 'Visual artifacts or their explicit retrieval gap are rendered' },
      { kind: 'expect_test_id', testId: 'discovery-package-comps', count: 1, description: 'Selected sold comp cards or the qualified-comp retrieval gap are rendered' },
      { kind: 'expect_test_id', testId: 'discovery-package-deed', count: 1, description: 'Ownership, deed, easement, restrictions, provenance, and retrieval gaps are visible' },
      { kind: 'expect_test_id', testId: 'discovery-package-sources', count: 1, description: 'Evidence source records are visible rather than count-only' },
      { kind: 'expect_test_id', testId: 'discovery-package-strategy-hypothesis', count: 2, description: 'Unsupported strategy rankings are replaced by two validation hypotheses' },
      { kind: 'expect_text', anyOf: ['Withheld — threshold not met'], description: 'Land Score and valuation remain withheld until evidence thresholds are met' },
      { kind: 'expect_text', anyOf: ['Deed retrieval gap: obtain the vesting deed'], description: 'Missing deed artifacts produce an exact safe retrieval action' },
      { kind: 'expect_test_id', testId: 'discovery-package-pdf', count: 1, description: 'The same report is downloadable as a PDF package' },
      { kind: 'forbid_text', anyOf: ['LandPortal is authoritative', 'Buy paid report', 'Use comp credit', 'Send offer', 'Send contract'], description: 'No terminal-provider, paid, offer, contract, or seller-outbound action is offered' },
      { kind: 'screenshot', name: 'ws3-visible-discovery-package', description: 'Capture the evidence-backed pre-discovery report' },
      { kind: 'refresh_persistence', expectAnyOf: ['Pre-call property research report'], expectTestId: 'discovery-package-entry', description: 'The report entry and current package survive refresh' },
      { kind: 'restart_persistence', expectAnyOf: ['Pre-call property research report'], expectTestId: 'discovery-package-entry', description: 'The report survives a canonical managed restart' },
    ],
    expectedBackendState: 'One persisted package projects parcel-associated artifacts, attributable deed/source records, evidence thresholds, gaps, and safe next actions from the canonical opportunity.',
    expectedFrontendState: 'One obvious report entry exposes actual evidence where available and explicit retrieval gaps where unavailable, without unsupported value, score, or strategy claims.',
    prohibitedContradictions: ['Opaque count-only evidence', 'Unsupported parcel value or Land Score', 'Unattributed deed conclusion', 'Legal/title advice', 'Paid or outbound action'],
    requiredScreenshots: ['ws3-visible-discovery-package'],
    persistence: { refresh: true, restart: true },
    allowedExternalBlockers: ['Unavailable public artifact, when the exact retrieval gap and safe next action remain visible'],
    passCriteria: 'The managed live browser opens the Lead Card and its one visible report, verifies evidence/gaps/provenance/gating, and passes refresh and restart persistence.',
    failureCriteria: 'Missing entry/report/evidence provenance, unsupported gated claims, prohibited action, or failed persistence.',
    mutating: false,
    fixturePolicy: 'Read-only against the isolated WS2 partial lead; no seller or external action is performed.',
  },
  {
    id: 'phase1-stabilization-safety',
    name: 'Phase 1 storage identity and functional safety surface',
    capability: 'phase1-stabilization',
    department: 'operations',
    startingState: 'Fresh production build on the operating storage profile; read-only QA.',
    operatorSteps: [
      { kind: 'navigate', path: '/mission', description: 'Open Mission Control' },
      { kind: 'expect_text', anyOf: ['OPERATING DATA'], description: 'The active operating-data profile is plainly visible' },
      { kind: 'api_reconcile', apiPath: '/api/landos/storage-profile', description: 'The visible storage identity is backed by the storage-profile API' },
      { kind: 'screenshot', name: 'phase1-operating-data', description: 'Capture the visible operating-data badge' },
      { kind: 'navigate', path: '/landos?view=org', description: 'Open the functional organization view' },
      { kind: 'expect_text', anyOf: ['Acquisitions Agent'], description: 'The acquisitions role uses a functional label' },
      { kind: 'expect_text', anyOf: ['Property Research Agent'], description: 'The research role uses a functional label' },
      { kind: 'forbid_text', anyOf: ['Duke', 'Ace', 'Finn', 'Mara', 'Mia', 'Drew', 'Rex', 'Web', 'Tutor'], description: 'Personal mascot labels are absent from the Phase 1 organization surface' },
      { kind: 'screenshot', name: 'phase1-functional-roles', description: 'Capture the functional organization roles' },
      { kind: 'refresh_persistence', expectAnyOf: ['Property Research Agent', 'Acquisitions Agent'], description: 'Functional role labels persist after refresh' },
    ],
    expectedBackendState: 'Storage profile is operating; LandPortal API/MCP and prohibited egress/paid actions remain unreachable by focused invariants.',
    expectedFrontendState: 'Mission Control identifies operating data and the organization exposes functional roles without mascot terminology.',
    prohibitedContradictions: ['QA data presented as operating data', 'Mascot labels visible', 'UI and storage-profile API disagree'],
    requiredScreenshots: ['phase1-operating-data', 'phase1-functional-roles'],
    persistence: { refresh: true, restart: false },
    allowedExternalBlockers: [],
    passCriteria: 'The live operating profile and functional roles are visible, API-backed, mascot-free, and refresh-stable.',
    failureCriteria: 'Missing/wrong storage identity, mascot terminology, API disagreement, or failed refresh.',
    mutating: false,
    fixturePolicy: 'Read-only and property-independent; no operating record is selected or changed.',
  },
  {
    // Re-baselined 2026-08-14 (verified regression, sprint
    // sprint-2026-08-14-lead-card-redesign finding F9): commit 00a89ac made
    // the Acquisition Workspace V2 the default composed operator view on the
    // Acquisitions entry path, so the former deal-card-root assertions could
    // never pass. The capability's intent is unchanged — ONE composed
    // canonical operator record view, and the retired Lead Workspace never
    // renders — now asserted against the V2 workspace root.
    id: 'acquisitions-deal-card-readonly',
    name: 'Canonical acquisitions record view (Workspace V2)',
    capability: 'acquisitions-deal-card',
    department: 'acquisitions',
    startingState: 'An existing safe deal-card fixture selected without modifying operator data.',
    operatorSteps: [
      { kind: 'select_card', criteria: 'any', description: 'Select an existing safe deal-card fixture' },
      { kind: 'navigate', path: ACQUISITIONS_DEAL_PATH, description: 'Open the canonical acquisitions record from the Acquisitions deep link' },
      { kind: 'expect_test_id', testId: 'acquisition-workspace-root', count: 1, description: 'The canonical Workspace V2 record root is present exactly once' },
      { kind: 'forbid_test_id', testId: 'lead-workspace-root', description: 'The retired legacy Lead Workspace never renders' },
      { kind: 'api_reconcile', apiPath: '/api/landos/deal-cards/{dealId}', description: 'The Deal Card API responds for the selected fixture' },
      { kind: 'forbid_text', anyOf: ['Â·', 'â€', '&amp;'], description: 'No double-encoded UTF-8 mojibake or literal HTML entity is visible to the operator' },
      { kind: 'screenshot', name: 'acquisitions-deal-card-desktop', description: 'Capture the desktop canonical record view' },
      { kind: 'refresh_persistence', expectAnyOf: [], expectTestId: 'acquisition-workspace-root', description: 'Reload and confirm the canonical record view remains available' },
      { kind: 'set_viewport', width: 412, height: 915, description: 'Use a Galaxy S24 Ultra-width mobile viewport' },
      { kind: 'expect_test_id', testId: 'acquisition-workspace-root', count: 1, description: 'The canonical record view remains available on mobile' },
      { kind: 'screenshot', name: 'acquisitions-deal-card-mobile', description: 'Capture the mobile canonical record view' },
    ],
    expectedBackendState: 'The deal-cards API returns the canonical read model for the selected fixture.',
    expectedFrontendState: 'Acquisitions renders the canonical Workspace V2 record view, never the retired Lead Workspace, on desktop and mobile.',
    prohibitedContradictions: ['Workspace V2 record root missing', 'Retired Lead Workspace rendered on any Acquisitions path'],
    requiredScreenshots: ['acquisitions-deal-card-desktop', 'acquisitions-deal-card-mobile'],
    persistence: { refresh: true, restart: false },
    allowedExternalBlockers: [],
    passCriteria: 'The read-only Acquisitions deep link, API, canonical Workspace V2 record root, refresh, and mobile viewport all pass.',
    failureCriteria: 'Missing record view/API, a retired Lead Workspace root, or failed refresh/mobile rendering.',
    mutating: false,
    fixturePolicy: 'Read-only against a dynamically selected existing deal-card fixture; never creates or updates an operator record.',
  },
  {
    id: 'phase1-manual-lead-promotion',
    name: 'Phase 1 manual lead creation and same-record promotion',
    capability: 'phase1-actionable-lead',
    department: 'acquisitions',
    startingState: 'Managed LandOS runtime explicitly using isolated synthetic-only QA storage.',
    operatorSteps: [
      { kind: 'navigate', path: '/dept/acquisitions?section=new', description: 'Open conversational manual lead intake' },
      { kind: 'expect_test_id', testId: 'manual-lead-form', count: 1, description: 'The conversational lead intake is rendered once' },
      { kind: 'expect_test_id', testId: 'manual-lead-raw-input', count: 1, description: 'Exactly one free-form data-dump area is available' },
      { kind: 'expect_test_id', testId: 'manual-lead-microphone', count: 1, description: 'Optional voice dictation control is visible' },
      { kind: 'fill_test_id', testId: 'manual-lead-raw-input', value: 'Seller: Synthetic Phase 1 Seller\nPhone: 704-555-0199\nThe seller inherited about 7.5 acres at 101 Phase 1 QA Isolation Road, Testville, NC and lives out of state. APN: QA-ONLY-101. They want a discovery call next week. Lead source: operator QA.', description: 'Paste one unstructured synthetic lead dump' },
      { kind: 'click_test_id', testId: 'manual-lead-create', description: 'Create the durable Lead Card and start research' },
      { kind: 'expect_test_id', testId: 'lead-workspace-root', count: 1, description: 'The new Lead Card opens immediately' },
      { kind: 'expect_test_id', testId: 'original-lead-intake', count: 1, description: 'The exact original data dump is visibly preserved on the Lead Card' },
      { kind: 'expect_test_id', testId: 'opportunity-actions', count: 1, description: 'Research and owner decision controls are actionable' },
      { kind: 'expect_test_id', testId: 'discovery-call-guardrail', count: 1, description: 'The discovery call remains explicitly unblocked' },
      { kind: 'screenshot', name: 'phase1-manual-lead', description: 'Capture the progressive Lead Card' },
      { kind: 'click_test_id', testId: 'pursue-opportunity-action', description: 'Owner promotes this same opportunity to a Deal' },
      { kind: 'expect_test_id', testId: 'deal-card-highlight', count: 1, description: 'The same card receives the subtle Deal highlight' },
      { kind: 'refresh_persistence', expectAnyOf: ['Pursued Deal'], expectTestId: 'deal-card-highlight', description: 'Promotion persists across a hard refresh' },
      { kind: 'navigate', path: '/mission', description: 'Open reconciled executive metrics' },
      { kind: 'api_reconcile', apiPath: '/api/landos/opportunities/metrics', description: 'Mission Control and the unified opportunity drilldown are backed by the same records' },
      { kind: 'screenshot', name: 'phase1-opportunity-metrics', description: 'Capture reconciled opportunity metrics' },
    ],
    expectedBackendState: 'Exactly one synthetic lead creates linked property/deal aliases and one opportunity; research starts and owner pursuit mutates the same opportunity row.',
    expectedFrontendState: 'One conversational data-dump intake opens an actionable Lead Card with the original source visible; discovery is unblocked and pursuit adds a subtle visual highlight that survives refresh.',
    prohibitedContradictions: ['Operating storage used as a fixture', 'Second opportunity created on pursuit', 'Discovery blocked by incomplete research', 'Paid or outbound action offered'],
    requiredScreenshots: ['phase1-manual-lead', 'phase1-opportunity-metrics'],
    persistence: { refresh: true, restart: false },
    allowedExternalBlockers: [],
    passCriteria: 'The isolated real-browser journey creates, opens, promotes, refreshes, and reconciles one synthetic opportunity through the operator UI.',
    failureCriteria: 'Creation does not open, actions are absent, promotion copies the record, highlight/persistence fails, or metrics cannot be opened.',
    mutating: true,
    fixturePolicy: 'Synthetic TEST LEAD only, and only while the managed runtime reports the physically isolated QA storage profile.',
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
    // Re-baselined 2026-07-24 (Tyler-directed): replaces the retired
    // phase1-unresolved-discovery-package journey. The Lead Workspace
    // discovery-package panel is retired; the truthful-incomplete pre-call
    // outcome now lives on the canonical Deal Card: honest unbuilt Property
    // Summary, unconfirmed facts marked unconfirmed, Smart Intake still
    // available, and no paid or outbound action — with refresh and managed
    // restart persistence.
    id: 'unresolved-lead-truthful-card',
    name: 'Unresolved lead renders a truthful canonical Deal Card',
    capability: 'phase1-discovery-package',
    department: 'acquisitions',
    startingState: 'An existing lead whose durable research mission rejected unassociated parcel evidence.',
    operatorSteps: [
      { kind: 'select_card', criteria: 'quarantined_research', description: 'Select an unresolved lead with durable rejected research evidence' },
      { kind: 'navigate', path: ACQUISITIONS_DEAL_PATH, description: 'Open its canonical Deal Card' },
      { kind: 'expect_test_id', testId: 'deal-card-root', count: 1, description: 'The canonical Deal Card renders' },
      { kind: 'expect_text', anyOf: ['No versioned Property Summary exists yet'], description: 'No fabricated report: the Property Summary honestly reports it has not been built' },
      { kind: 'expect_text', anyOf: ['Not yet confirmed'], description: 'Unconfirmed facts are visibly marked unconfirmed, never invented' },
      { kind: 'expect_test_id', testId: 'open-smart-intake', count: 1, description: 'Smart Intake evidence capture remains available; the human call path is not blocked' },
      { kind: 'forbid_text', anyOf: ['Call prep is ready even when research is incomplete', 'Two strongest first-look strategies'], description: 'The prior false-ready and unsupported-ranking claims are absent' },
      { kind: 'forbid_text', anyOf: ['Buy paid report', 'Use comp credit', 'Send offer', 'Send contract'], description: 'No paid or prohibited outbound action is offered' },
      { kind: 'screenshot', name: 'unresolved-truthful-card', description: 'Capture the truthful unresolved canonical Deal Card' },
      { kind: 'refresh_persistence', expectAnyOf: ['Not yet confirmed'], expectTestId: 'deal-card-root', description: 'The truthful unresolved state persists across hard refresh' },
      { kind: 'restart_persistence', expectAnyOf: ['Not yet confirmed'], expectTestId: 'deal-card-root', description: 'The truthful unresolved state persists across a canonical managed restart' },
    ],
    expectedBackendState: 'The canonical deal-card read model reports the unresolved identity honestly; no fabricated summary, valuation, or strategy exists for the unconfirmed parcel.',
    expectedFrontendState: 'The canonical Deal Card says plainly what is not yet confirmed, offers Smart Intake for more evidence, and never claims readiness or offers paid/outbound actions.',
    prohibitedContradictions: ['Incomplete research labeled ready', 'Unconfirmed facts presented as confirmed', 'Paid/API action offered'],
    requiredScreenshots: ['unresolved-truthful-card'],
    persistence: { refresh: true, restart: true },
    allowedExternalBlockers: [],
    passCriteria: 'The unresolved canonical Deal Card is truthful, keeps evidence intake open, offers no prohibited action, and persists through refresh/restart.',
    failureCriteria: 'False ready claim, fabricated facts, missing Smart Intake path, prohibited action, or persistence failure.',
    mutating: false,
    fixturePolicy: 'Read-only selection by durable quarantined-research state; no provider action or owner decision.',
  },
  {
    id: 'phase1-transcript-reconciliation',
    name: 'Phase 1 immutable transcript reconciliation',
    capability: 'phase1-transcript-reconciliation',
    department: 'acquisitions',
    startingState: 'An isolated synthetic QA Lead Card with a current discovery package.',
    operatorSteps: [
      { kind: 'select_card', criteria: 'any', description: 'Select an isolated synthetic Lead Card' },
      { kind: 'navigate', path: ACQUISITIONS_DEAL_PATH, description: 'Open the Lead Workspace transcript surface' },
      { kind: 'expect_test_id', testId: 'transcript-reconciliation', count: 1, description: 'Transcript paste and upload controls are on the Lead Card' },
      { kind: 'fill_test_id', testId: 'transcript-paste-input', value: 'Synthetic QA discovery call. Seller Morgan Test says heir Casey Test also decides. They inherited the land, want to sell within 30 days, and ask $72,000. Seller says the tract is 18 acres with road access and power, but current research has not verified acreage or utilities. Call the owner back Friday after verifying acreage and access.', description: 'Paste a synthetic discovery transcript with parties, motivation, price, timeline, claims, conflict, and follow-up' },
      { kind: 'click_test_id', testId: 'transcript-paste-submit', description: 'Preserve the exact pasted original and reconcile it' },
      { kind: 'expect_test_id', testId: 'transcript-reconciliation-output', count: 1, description: 'The reconciliation output opens on the same Lead Card' },
      { kind: 'expect_test_id', testId: 'transcript-summary', count: 1, description: 'A concise call summary is visible' },
      { kind: 'expect_test_id', testId: 'transcript-next-action', count: 1, description: 'Exactly one allowed next action is visible' },
      { kind: 'upload_text_test_id', testId: 'transcript-file-input', fileName: 'phase1-synthetic-followup.txt', content: 'Synthetic QA follow-up transcript. Morgan Test confirms Casey Test is an heir and decision-maker. Asking price remains $72,000 and preferred close is within 30 days. Verify legal acreage, road access, and utilities before the owner decides.', description: 'Upload a second synthetic text transcript through the real file control' },
      { kind: 'expect_test_id', testId: 'transcript-reconciliation-output', count: 1, description: 'Uploaded transcript is preserved and reconciled' },
      { kind: 'screenshot', name: 'phase1-transcript-reconciliation', description: 'Capture attributed statements, conflicts, tasks, and next action' },
      { kind: 'refresh_persistence', expectAnyOf: ['immutable originals', 'Concise call summary'], expectTestId: 'transcript-reconciliation-output', description: 'Transcript and reconciliation survive hard refresh' },
      { kind: 'restart_persistence', expectAnyOf: ['immutable originals', 'Concise call summary'], expectTestId: 'transcript-reconciliation-output', description: 'Transcript and reconciliation survive managed restart' },
      { kind: 'api_reconcile', apiPath: '/api/landos/opportunities/{opportunityId}/reconciliation', description: 'Persisted latest reconciliation remains available from the canonical API' },
      { kind: 'forbid_text', anyOf: ['Send offer', 'Send contract', 'Contact seller', 'Buy paid report', 'Use comp credit'], description: 'Paid and seller/outbound/offer/contract actions remain absent' },
    ],
    expectedBackendState: 'Both immutable originals and versioned reconciliation outputs are durable, attributed, task-producing, and linked to the same opportunity.',
    expectedFrontendState: 'The Lead Card supports paste and real text-file upload, separates seller statements from facts, shows conflicts/work, and exposes one safe next action.',
    prohibitedContradictions: ['Original transcript mutates', 'Seller claim becomes verified fact', 'Automatic pursuit', 'Paid or seller-outbound action offered'],
    requiredScreenshots: ['phase1-transcript-reconciliation'],
    persistence: { refresh: true, restart: true },
    allowedExternalBlockers: [],
    passCriteria: 'Paste, file upload, reconciliation, safety constraints, API state, refresh, and managed restart pass in isolated QA storage.',
    failureCriteria: 'Either input fails, originals are mutable/lost, outputs are incomplete, seller claims are promoted, or prohibited action appears.',
    mutating: true,
    fixturePolicy: 'Synthetic transcript content only, using an existing TEST LEAD and runtime-generated .txt artifact under the isolated QA evidence root.',
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
      { kind: 'expect_text', anyOf: ['WRONG PARCEL', 'conflict', 'Conflict', 'mismatch'], description: 'The conflict is disclosed, not hidden' },
      { kind: 'expect_text', anyOf: ['different parcel', 'does not match', 'not the requested parcel'], description: 'The contrast is explicit: the resolved candidate is not the requested parcel' },
      { kind: 'expect_text', anyOf: ['NOT accepted', 'not confirmed', 'NOT confirmed', 'on hold', 'No Property Intelligence'], description: 'The record states why it is blocked and that nothing downstream ran' },
      { kind: 'forbid_text', anyOf: ['Verified parcel identity accepted'], description: 'The conflicted parcel is never presented as verified' },
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
  {
    // Re-baselined 2026-07-24 (Tyler-directed): replaces the retired
    // phase1-verified-research-mission journey. The Lead Workspace mission
    // panel is retired; the durable-mission and quarantine outcome now lives
    // on the canonical Deal Card research-progress panel: a quarantined
    // mission is disclosed as needing parcel confirmation, rejected evidence
    // is excluded from the canonical record and says so, and the safe next
    // action is an explicit operator re-run control.
    id: 'research-quarantine-honesty',
    name: 'Quarantined research mission on the canonical Deal Card',
    capability: 'phase1-verified-research-mission',
    department: 'research',
    startingState: 'An existing operating lead with a completed research mission and retained quarantined evidence; read-only QA.',
    operatorSteps: [
      { kind: 'select_card', criteria: 'quarantined_research', description: 'Select a lead whose research agent rejected unassociated or contradictory parcel evidence' },
      { kind: 'navigate', path: ACQUISITIONS_DEAL_PATH, description: 'Open the selected canonical Deal Card' },
      { kind: 'expect_test_id', testId: 'deal-card-root', count: 1, description: 'The canonical Deal Card renders' },
      { kind: 'expect_test_id', testId: 'deal-card-research-progress', count: 1, description: 'The durable research mission status is visible on the canonical Deal Card' },
      { kind: 'expect_text', anyOf: ['Research needs parcel confirmation'], description: 'The quarantined mission is disclosed as needing parcel confirmation' },
      { kind: 'expect_text', anyOf: ['No parcel evidence was promoted'], description: 'Rejected evidence is excluded from the canonical record and says so' },
      { kind: 'expect_test_id', testId: 'deal-card-research-retry', count: 1, description: 'The safe next action is an explicit operator re-run control' },
      { kind: 'forbid_text', anyOf: ['Automatic property research complete'], description: 'A quarantined mission is never presented as complete' },
      { kind: 'api_reconcile', apiPath: '/api/landos/deal-cards/{dealId}', description: 'The visible card agrees with the canonical deal-card API' },
      { kind: 'screenshot', name: 'research-quarantine-honesty', description: 'Capture the quarantined mission disclosure and re-run control' },
      { kind: 'refresh_persistence', expectAnyOf: ['Research needs parcel confirmation'], expectTestId: 'deal-card-research-progress', description: 'Mission state and quarantine disclosure remain visible after refresh' },
      { kind: 'restart_persistence', expectAnyOf: ['Research needs parcel confirmation'], expectTestId: 'deal-card-research-progress', description: 'Mission state and quarantine disclosure survive a managed restart' },
    ],
    expectedBackendState: 'The durable mission preserves bounded attempts, verification outcome, safe next action, and quarantined evidence without promoting rejected parcel data.',
    expectedFrontendState: 'The canonical Deal Card visibly discloses the quarantined mission, the exclusion of rejected evidence, and an explicit re-run control.',
    prohibitedContradictions: ['Wrong-jurisdiction facts promoted', 'Quarantined mission presented as complete', 'Quarantined evidence projected as canonical'],
    requiredScreenshots: ['research-quarantine-honesty'],
    persistence: { refresh: true, restart: true },
    allowedExternalBlockers: [],
    passCriteria: 'The durable quarantined mission remains API-backed and visible on the canonical Deal Card through refresh and restart.',
    failureCriteria: 'Mission state disappears, rejected evidence is promoted, quarantine reads as complete, or frontend and API disagree.',
    mutating: false,
    fixturePolicy: 'Read-only selection by durable research state; no provider or operating-data mutation.',
  },
  {
    id: 'phase1-shell-free-navigation',
    name: 'Phase 1 shell-free cross-surface navigation',
    capability: 'phase1-windows-runtime',
    department: 'platform',
    startingState: 'Managed Windows runtime healthy; no record mutation required.',
    operatorSteps: [
      { kind: 'navigate', path: '/mission', description: 'Open Mission Control' },
      { kind: 'expect_text', anyOf: ['Mission Control'], description: 'Mission Control renders' },
      { kind: 'expect_test_id', testId: 'max-dock', count: 1, description: 'Max is present on Mission Control without navigation' },
      { kind: 'expect_test_id', testId: 'max-dock-input', count: 1, description: 'Max accepts immediate text input' },
      { kind: 'expect_test_id', testId: 'max-dock-microphone', count: 1, description: 'Max exposes browser voice input' },
      { kind: 'api_reconcile', apiPath: '/api/agents', description: 'Agent status returns through the shell-free in-process PID probe' },
      { kind: 'navigate', path: '/dept/acquisitions', description: 'Navigate to Acquisitions' },
      { kind: 'expect_text', anyOf: ['Acquisitions'], description: 'Acquisitions renders' },
      { kind: 'expect_test_id', testId: 'max-dock', count: 1, description: 'Max remains present on Acquisitions' },
      { kind: 'navigate', path: '/chat', description: 'Navigate to the full Max conversation' },
      { kind: 'expect_text', anyOf: ['Max'], description: 'Max conversation renders' },
      { kind: 'expect_test_id', testId: 'max-dock', count: 1, description: 'Persistent Max remains available on the full conversation page' },
      { kind: 'navigate', path: '/mission', description: 'Return to Mission Control' },
      { kind: 'screenshot', name: 'phase1-shell-free-navigation', description: 'Capture the final responsive Mission Control surface' },
      { kind: 'refresh_persistence', expectAnyOf: ['Mission Control'], description: 'The repaired navigation path remains healthy after refresh' },
    ],
    expectedBackendState: 'The agent roster is evaluated in-process without tasklist, PowerShell, cmd, or one blocking child process per agent.',
    expectedFrontendState: 'Mission Control, Acquisitions, and Max render successively; the Max dock remains present without a visible external shell window.',
    prohibitedContradictions: ['Visible console window', 'Multi-second /api/agents process shell', 'A surface fails after navigation or restart'],
    requiredScreenshots: ['phase1-shell-free-navigation'],
    persistence: { refresh: true, restart: true },
    allowedExternalBlockers: [],
    passCriteria: 'All three live surfaces and /api/agents respond, refresh, and survive restart with no child-process shell path.',
    failureCriteria: 'Any visible shell, failed surface, slow blocking status request, API disagreement, or restart regression.',
    mutating: false,
    fixturePolicy: 'Read-only and property-independent.',
  },
  {
    id: 'zoning-land-use-panel',
    name: 'Persisted Zoning & Land Use panel on the Deal Card',
    capability: 'zoning-land-use',
    department: 'acquisitions',
    startingState: 'A confirmed deal card; the zoning panel reads only the persisted snapshot and never triggers research on load.',
    operatorSteps: [
      ...dealCardShell('verified_strong_evidence', 'zoning-deal-card'),
      { kind: 'click_text', text: 'Due Diligence', description: 'Open the Due Diligence tab' },
      { kind: 'expect_test_id', testId: 'zoning-land-use-panel', count: 1, description: 'The persisted Zoning & Land Use panel renders' },
      { kind: 'expect_test_id', testId: 'zoning-rebuild', count: 1, description: 'Zoning research is an explicit operator command' },
      { kind: 'expect_text', anyOf: ['Zoning & Land Use'], description: 'The panel heading is visible' },
      { kind: 'api_reconcile', apiPath: '/api/landos/deal-cards/{dealId}/zoning-land-use', description: 'The zoning GET responds and matches the persisted state the panel renders' },
      { kind: 'screenshot', name: 'zoning-land-use-panel', description: 'Capture the zoning & land-use panel' },
      { kind: 'refresh_persistence', expectAnyOf: ['Due Diligence', 'Overview'], description: 'The Deal Card (including the zoning slice state) survives refresh; loading performs no zoning research' },
    ],
    expectedBackendState: 'GET /zoning-land-use is SELECT-only; the persisted snapshot (or honest null) is returned unchanged by loading.',
    expectedFrontendState: 'The Due Diligence tab shows the Zoning & Land Use panel with either the persisted snapshot content or the honest not-researched state and an explicit rebuild control.',
    prohibitedContradictions: ['Panel content disagrees with the zoning GET payload', 'Loading the card creates zoning jobs, evidence, or snapshots', 'Conditional uses shown as by-right'],
    requiredScreenshots: ['zoning-deal-card', 'zoning-land-use-panel'],
    persistence: { refresh: true, restart: false },
    allowedExternalBlockers: [],
    passCriteria: 'Panel renders from the persisted read model, reconciles with the API, and loading stays read-only.',
    failureCriteria: 'Missing panel or rebuild control, API/frontend divergence, or any zoning write triggered by loading.',
    mutating: false,
    fixturePolicy: 'Read-only against an existing confirmed card; the rebuild command is never clicked by this journey.',
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
