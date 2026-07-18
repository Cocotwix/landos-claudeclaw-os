// Static checks on the LandOS Intake / Orchestration dashboard UI. The web app
// runs in a browser (no jsdom in this node test env), so behavior is covered by
// the intake planner contract tests; here we statically verify the UI wiring:
// the dashboard entry point, the authenticated API call, the required operator
// sections, the hard business-rule banners, and the no-paid-call / no-coordinate
// guarantees. Mirrors the property-board-ui.test.ts source-scan style.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { fileURLToPath } from 'url';

const PANEL = fs.readFileSync(
  fileURLToPath(new URL('../../web/src/components/IntakePlanner.tsx', import.meta.url)),
  'utf-8',
);
const PAGE = fs.readFileSync(
  fileURLToPath(new URL('../../web/src/pages/LandOS.tsx', import.meta.url)),
  'utf-8',
);

describe('LandOS page intake entry point', () => {
  it('keeps the Intake Planner view reachable by deep link (now owned by Acquisitions), not as a spine tab', () => {
    expect(PAGE).toMatch(/import \{ IntakePlanner \} from '@\/components\/IntakePlanner'/);
    // Intake moved into the Acquisitions department workspace (New Lead); its
    // spine view stays reachable via ?view=intake for backward compatibility.
    expect(PAGE).not.toMatch(/<Tab label="Intake Planner"/);
    expect(PAGE).toMatch(/view === 'intake' && <IntakePlanner \/>/);
  });

  it('keeps the Overview entity filters scoped to the overview view', () => {
    expect(PAGE).toMatch(/label="Overview"/);
    expect(PAGE).toMatch(/view === 'overview' && data/);
  });
});

describe('Intake panel API wiring (authenticated, read-only)', () => {
  it('calls the real intake route through the shared apiPost helper (token via helper)', () => {
    expect(PANEL).toMatch(/import \{ apiPost \} from '@\/lib\/api'/);
    expect(PANEL).toMatch(/apiPost<[^>]*>\('\/api\/landos\/intake'/);
    // dashboard_text transport — the manual dashboard path of the unified intake.
    expect(PANEL).toMatch(/transport: 'dashboard_text'/);
  });

  it('has a textarea input and loading/error/success states', () => {
    expect(PANEL).toMatch(/<textarea/);
    expect(PANEL).toMatch(/setLoading\(true\)/);
    expect(PANEL).toMatch(/Planning…/);
    expect(PANEL).toMatch(/Intake failed/);
  });

  it('does not implement custom token logic (auth comes only from apiPost)', () => {
    expect(/token=/.test(PANEL)).toBe(false);
    expect(/sessionStorage/.test(PANEL)).toBe(false);
  });
});

describe('Intake panel operator sections', () => {
  // Literal section headings present in the source. The per-lane sections
  // (Duke / Ace / etc.) are data-driven labels, covered by the lane test below.
  const SECTIONS = [
    'Classification',
    'Market Research',
    'Strategy',
    'Underwriting',
    'Deal Card Persistence',
    'Voice Response',
    'Forge',
    'Inter-Agent Collaboration',
    'Model Routing',
    'Department Registry',
  ];
  it('renders every required section heading', () => {
    for (const s of SECTIONS) {
      expect(PANEL.includes(s), `missing section ${s}`).toBe(true);
    }
  });

  it('renders each worker lane via a status-badged LaneRow', () => {
    for (const lane of [
      'dukeParcelVerification', 'marketResearch', 'strategy', 'underwriting',
      'aceDiscoveryPrep', 'dealCardPersistence', 'voiceResponse', 'forgeRepair',
      'forgeBuildInterview', 'agentKnowledgeRetrieval', 'interAgentCollaboration', 'modelRouting',
    ]) {
      expect(PANEL.includes(`plan.${lane}`), `missing lane ${lane}`).toBe(true);
    }
  });

  it('shows the execution mode and labels it read-only', () => {
    expect(PANEL).toMatch(/Execution mode/);
    expect(PANEL).toMatch(/plan\.executionMode/);
    expect(PANEL).toMatch(/read-only plan/);
  });

  it('does not dump raw JSON as the primary view (no JSON.stringify of the plan)', () => {
    expect(/JSON\.stringify/.test(PANEL)).toBe(false);
  });
});

describe('Intake panel hard business rules', () => {
  it('maps every required status label to a treatment', () => {
    for (const label of ['planned', 'blocked', 'not_available', 'not_applicable', 'supported', 'available']) {
      expect(PANEL.includes(`'${label}'`), `statusClass missing ${label}`).toBe(true);
    }
  });

  it('shows a visible Strategy/Underwriting blocked banner when parcel is unverified', () => {
    expect(PANEL).toMatch(/strategyStatus === 'blocked' \|\| su\?\.underwritingStatus === 'blocked'/);
    expect(PANEL).toMatch(/Strategy and Underwriting are blocked/);
  });

  it('shows a Market Research not_available banner driven by the plan', () => {
    expect(PANEL).toMatch(/marketResearch\.status === 'not_available'/);
    expect(PANEL).toMatch(/Market Research not_available/);
  });

  it('renders persistence targets with their truth labels (never as plain verified facts)', () => {
    expect(PANEL).toMatch(/persistenceTargets\.map/);
    expect(PANEL).toMatch(/StatusBadge status=\{t\.label\}/);
    expect(PANEL).toMatch(/dealCardPersistencePlan\.rule/);
  });

  it('never calls paid LandPortal comp tools and uses no coordinate/proximity identity language', () => {
    expect(/lp_comp_report_create\s*\(/.test(PANEL)).toBe(false);
    expect(/lp_comp_report_get\s*\(/.test(PANEL)).toBe(false);
    // The GIS cutoff text (server-supplied) may mention coordinate/proximity as a
    // STOP condition, but the UI source must not introduce its own banned phrases.
    expect(/geocod|nearest parcel|map pin|satellite|street view/i.test(PANEL)).toBe(false);
  });
});

describe('Intake panel source-adapter / Market Pulse section (Sprint 6A)', () => {
  it('renders a Source Adapters / Market Pulse section', () => {
    expect(PANEL).toMatch(/Source Adapters \/ Market Pulse/);
  });

  it('shows adapter readiness, the parcel fallback ladder, and the LandPortal failure plan', () => {
    expect(PANEL).toMatch(/adapterReadiness\.map/);
    expect(PANEL).toMatch(/parcelFallbackLadder\.map/);
    expect(PANEL).toMatch(/landportalFailureFallbackPlan\.map/);
  });

  it('surfaces the GIS cutoff rule from the plan (not hardcoded prose)', () => {
    expect(PANEL).toMatch(/sourceAdapter\.gisCutoff\.rule/);
  });

  it('shows Market Pulse status, the Local Area Context label, and on-demand scope', () => {
    expect(PANEL).toMatch(/sourceAdapter\.marketPulse\.status/);
    expect(PANEL).toMatch(/sourceAdapter\.marketPulse\.localAreaContextLabel/);
    expect(PANEL).toMatch(/onDemandScope/);
    expect(PANEL).toMatch(/no bulk datasets/i);
  });

  it('shows seller ask as seller_stated and never an offer-range basis', () => {
    expect(PANEL).toMatch(/sourceAdapter\.sellerAsk\.label/);
    expect(PANEL).toMatch(/never anchors the calculated offer range/);
  });

  it('shows the third-party / open-source security posture (report-only candidates)', () => {
    expect(PANEL).toMatch(/thirdPartySecurity/);
    expect(PANEL).toMatch(/No third-party code installed or executed/);
    expect(PANEL).toMatch(/report-only and require Tyler approval/);
  });
});

describe('Intake panel due diligence result', () => {
  it('has a functional-role parcel verification button wired to the bridge route', () => {
    expect(PANEL).toMatch(/Run parcel verification/);
    expect(PANEL).toMatch(/apiPost<[^>]*>\('\/api\/landos\/intake\/duke-verification'/);
    expect(PANEL).toMatch(/function runDuke/);
    expect(PANEL).toMatch(/onClick=\{\(\) => void runDuke\(\)\}/);
  });

  it('acts on the text that produced the plan and never silently no-ops', () => {
    expect(PANEL).toMatch(/setPlanText/);
    expect(PANEL).toMatch(/const input = \(planText \|\| text\)\.trim\(\)/);
    expect(PANEL).toMatch(/setDukeError\('Run an intake plan first/);
    expect(/const trimmed = text\.trim\(\);\s*if \(!trimmed\) return;/.test(PANEL)).toBe(false);
  });

  it('shows an explicit loading panel and error state', () => {
    expect(PANEL).toMatch(/dukeLoading && \(/);
    expect(PANEL).toMatch(/Running due-diligence parcel verification…/);
    expect(PANEL).toMatch(/Verifying…/);
    expect(PANEL).toMatch(/Verification failed/);
  });

  it('has NO temporary diagnostics in the final UI (no dvb marker, click counter, or stage line)', () => {
    expect(/data-duke-build|dvb-\d/.test(PANEL)).toBe(false);
    expect(/data-duke-diag|Duke action:|dukeClicks|dukeStage|onDukeClick/.test(PANEL)).toBe(false);
  });

  it('renders rich verified property data: identity, facts, valuation, similars', () => {
    expect(PANEL).toMatch(/parcelVerified && duke\.verification\.propertyData/);
    expect(PANEL).toMatch(/Identity &amp; Owner/);
    expect(PANEL).toMatch(/Property Facts/);
    expect(PANEL).toMatch(/Valuation \(LandPortal\)/);
    expect(PANEL).toMatch(/Similar Sales/);
    expect(PANEL).toMatch(/propertyData\.identity\.propertyId/);
    expect(PANEL).toMatch(/propertyData\.landFacts\.acres/);
    expect(PANEL).toMatch(/propertyData\.valuation\.marketTotal/);
    expect(PANEL).toMatch(/Source: \{duke\.verification\.propertyData\.sourceName\}/);
  });

  it('renders individual embedded comp rows when present, else a clear aggregate-only limitation note', () => {
    expect(PANEL).toMatch(/Similar Sales \/ Embedded Comps/);
    expect(PANEL).toMatch(/propertyData\.similarRowsAvailable/);
    expect(PANEL).toMatch(/propertyData\.similarSales\.map/);
    expect(PANEL).toMatch(/LandPortal property_data embedded similar sales/);
    expect(PANEL).toMatch(/Only aggregate embedded similar-sales stats were returned/);
    expect(PANEL).toMatch(/require an approved comp report credit or another approved source/);
  });

  it('never references a paid comp report tool in the non-comp path', () => {
    expect(/lp_comp_report_create|lp_comp_report_get/.test(PANEL)).toBe(false);
  });

  it('renders Strategy/Underwriting readiness with flags, candidates, and the $10k baseline', () => {
    expect(PANEL).toMatch(/Strategy \/ Underwriting Readiness/);
    expect(PANEL).toMatch(/dukeAnalysis\.strategyStatus/);
    expect(PANEL).toMatch(/dukeAnalysis\.greenFlags/);
    expect(PANEL).toMatch(/dukeAnalysis\.redFlags/);
    expect(PANEL).toMatch(/dukeAnalysis\.strategyCandidates\.map/);
    expect(PANEL).toMatch(/offerReadiness\.minNetProfitBaselineUsd/);
  });

  it('renders Acquisitions discovery prep as questions', () => {
    expect(PANEL).toMatch(/Acquisitions Discovery Prep/);
    expect(PANEL).toMatch(/acePrep\.questions\.map/);
  });

  it('shows the Local Area Context label and the next required identifier when unverified', () => {
    expect(PANEL).toMatch(/verification\.localAreaContextLabel/);
    expect(PANEL).toMatch(/verification\.nextAction/);
    expect(PANEL).toMatch(/Strategy and Underwriting blocked/);
  });

  it('shows a supersede banner and suppresses the stale unverified banner once Duke verifies', () => {
    // When a Duke execution result exists, a banner clarifies it supersedes the
    // read-only plan; and the read-only "Parcel unverified" guard banner is
    // suppressed once the execution result is verified.
    expect(PANEL).toMatch(/supersedes the read-only plan status/);
    expect(PANEL).toMatch(/strategyBlocked && !duke\?\.verification\.parcelVerified/);
  });

  it('renders source attempts and source-returned data gaps', () => {
    expect(PANEL).toMatch(/sourceAttempts\.map/);
    expect(PANEL).toMatch(/propertyData\.dataGaps\.join/);
  });

  it('renders the Deal Card Update Plan with truth-labeled timeline entries', () => {
    expect(PANEL).toMatch(/Deal Card Update Plan/);
    expect(PANEL).toMatch(/dealCardUpdatePlan\.timeline\.map/);
    expect(PANEL).toMatch(/StatusBadge status=\{t\.truthLabel\}/);
    expect(PANEL).toMatch(/dealCardUpdatePlan\.migrationNote/);
  });

  it('renders the Market Pulse v1 panel with label, signals, and safe source links', () => {
    expect(PANEL).toMatch(/Market Pulse v1/);
    expect(PANEL).toMatch(/marketPulse\.label/);
    expect(PANEL).toMatch(/marketPulse\.signals\.map/);
    expect(PANEL).toMatch(/StatusBadge status=\{s\.status\}/);
    expect(PANEL).toMatch(/s\.sourceUrl[\s\S]{0,260}target="_blank"[\s\S]{0,80}rel="noopener noreferrer"/);
    expect(PANEL).toMatch(/marketPulse\.disclaimer/);
    expect(PANEL).toMatch(/marketPulse\.generatedAt/);
  });
});
