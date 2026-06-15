// Forge engagement workflow — the operational core of Universal Forge.
//
// Forge is a universal, industry-neutral builder. This module is deliberately
// host-agnostic: it carries no business- or domain-specific concepts, no
// dependencies, no network calls, no filesystem access, and no env reads. It
// is pure and deterministic so it can be tested cheaply and later lifted into
// a standalone forge-core repo without rework.
//
// What it does: take a raw build request from the owner and turn it into a
// structured engagement artifact through the Forge rhythm —
//   Interview -> Assumption Summary -> Milestone Build Plan ->
//   Security Review -> QA Review -> Promotion Review ->
//   Owner Direction Review -> Next Milestone
//
// The load-bearing logic is the LANE GATE: a conservative classifier that
// decides whether a request is safe to build inside Forge's repo-local lane
// (SAFE) or whether it touches an owner-owned decision and must stop (STOP).
//
// IMPORTANT: the lane gate is a triage aid, not a security boundary. STOP is
// intentionally conservative (better to over-flag an owner decision than to
// act on one unasked). SAFE means "no red-lane trigger was detected" — the
// operator still applies judgment before building.

/** Outcome of the lane gate. */
export type ForgeLaneVerdict = 'SAFE' | 'STOP';

/** The owner-owned red-lane categories. Each maps to a real hard-stop in the
 *  Forge Core Policy. A request matching any of these stops for the owner. */
export type RedLaneCategory =
  | 'secrets_credentials'
  | 'paid_tools_apis'
  | 'subscriptions_billing'
  | 'account_connection'
  | 'destructive_or_deletion'
  | 'broad_repo_rewrite'
  | 'git_push_or_deploy'
  | 'financial_legal_platform'
  | 'dependency_install';

interface RedLaneRule {
  category: RedLaneCategory;
  /** Human-readable label shown to the owner in the artifact. */
  label: string;
  patterns: RegExp[];
}

/** The red-lane rule set. Patterns are matched case-insensitively against the
 *  raw request text. Kept conservative and explicit so behavior is obvious and
 *  testable. This is the single source of truth for the stop list. */
const RED_LANE_RULES: readonly RedLaneRule[] = [
  {
    category: 'secrets_credentials',
    label: 'Secrets / credentials',
    patterns: [
      /\bsecrets?\b/i,
      /\bcredentials?\b/i,
      /\bpasswords?\b/i,
      /\bapi[\s_-]?keys?\b/i,
      /\bjwts?\b/i,
      /\b(access|bearer|auth)[\s_-]?tokens?\b/i,
      /\btokens?\b/i,
      /\.env\b/i,
    ],
  },
  {
    category: 'paid_tools_apis',
    label: 'Paid tools / paid APIs',
    patterns: [
      /\bpaid\s+(api|apis|tool|tools|service|services|usage|plan|tier)\b/i,
      /\bmetered\b/i,
      /\bopenrouter\b/i,
      /\bfusion\b/i,
      /\bpremium\s+(api|tier|plan|tool)\b/i,
      /\bpay\s+(for|per)\b/i,
    ],
  },
  {
    category: 'subscriptions_billing',
    label: 'Subscriptions / billing',
    patterns: [
      /\bsubscriptions?\b/i,
      /\bsubscribe\b/i,
      /\bbilling\b/i,
      /\binvoices?\b/i,
      /\bcredit\s+card\b/i,
      /\bupgrade\s+(the\s+|our\s+|my\s+)?(plan|account|tier|subscription)\b/i,
    ],
  },
  {
    category: 'account_connection',
    label: 'Private account connection',
    patterns: [
      /\bconnect\s+(my|the|our|a|an)\s+[\w\s]*account\b/i,
      /\blink\s+(my|the|our)\s+[\w\s]*account\b/i,
      /\blog\s?in\s+to\b/i,
      /\bsign\s?in\s+to\b/i,
      /\boauth\b/i,
      /\bprivate\s+account\b/i,
    ],
  },
  {
    category: 'destructive_or_deletion',
    label: 'Destructive action / file deletion',
    patterns: [
      /\bdeletes?\b/i,
      /\bdeleting\b/i,
      /\brm\s+-rf\b/i,
      /\bremove\s+(the\s+|all\s+)?(files?|directory|folder|repo)\b/i,
      /\bdrop\s+(the\s+|a\s+|all\s+)?(table|tables|database|db|schema)\b/i,
      /\btruncate\b/i,
      /\bwipe\b/i,
      /\bdestroy\b/i,
      /\boverwrite\b/i,
      /\bpurge\b/i,
    ],
  },
  {
    category: 'broad_repo_rewrite',
    label: 'Broad repo rewrite',
    patterns: [
      /\b(rewrite|refactor|overhaul|rebuild)\s+(the\s+)?(whole|entire|complete)\s+(repo|repository|codebase|project|system|app)\b/i,
      /\brewrite\s+everything\b/i,
      /\brefactor\s+everything\b/i,
      /\bmass\s+(rename|rewrite|refactor|edit|delete)\b/i,
      /\bbroad\s+(repo|repository|codebase)\b/i,
    ],
  },
  {
    category: 'git_push_or_deploy',
    label: 'Git push / deploy',
    patterns: [
      /\bgit\s+push\b/i,
      /\bpush\s+(to\s+)?(origin|remote|main|master|prod|production|staging|github|gitlab)\b/i,
      /\bforce[\s-]?push\b/i,
      // Deploy is owner-owned generally, not only for prod/live. Match the
      // verb "deploy" on its own (\bdeploy\b excludes "deployment", so docs
      // about deployment do not trip the gate).
      /\bdeploy\b/i,
      /\brelease\s+(this|it|that|the\s+build|the\s+app|the\s+package|the\s+version)\b/i,
      /\bpush\s+(my|the|our|these|this)\s+(changes?|commits?|code|branch)\b/i,
      /\bpublish\s+(the\s+)?(package|release)\b/i,
    ],
  },
  {
    category: 'financial_legal_platform',
    label: 'Financial / legal platform access',
    patterns: [
      /\bstripe\b/i,
      /\bbank\s+account\b/i,
      /\bwire\s+(money|funds|transfer)\b/i,
      /\bpayment\s+(platform|processor|gateway)\b/i,
      /\blegal\s+(platform|document|contract)\b/i,
      /\bdocusign\b/i,
      /\bsend\s+(money|funds|payment)\b/i,
    ],
  },
  {
    category: 'dependency_install',
    label: 'Dependency install',
    patterns: [
      /\bnpm\s+(install|i)\b/i,
      /\byarn\s+add\b/i,
      /\bpnpm\s+add\b/i,
      /\binstall\s+(a\s+|the\s+|this\s+)?(package|dependency|dependencies|library|module)\b/i,
      /\badd\s+(a\s+|the\s+|this\s+|an?\s+)?(dependency|dependencies|npm\s+package|package|library)\b/i,
    ],
  },
];

/** A single red-lane match. */
export interface RedLaneHit {
  category: RedLaneCategory;
  label: string;
  /** The exact substring that matched, so the owner sees why it stopped. */
  matchedText: string;
}

/** Result of the lane gate. */
export interface ForgeLaneGate {
  verdict: ForgeLaneVerdict;
  hits: RedLaneHit[];
  /** Distinct categories that fired, in rule order. */
  categories: RedLaneCategory[];
  /** Plain-language notice for the artifact. */
  notice: string;
}

/** The owner's raw request into Forge. Only `rawRequest` is required. */
export interface ForgeEngagementRequest {
  /** Short label for the engagement. Falls back to a derived title. */
  title?: string;
  /** The raw, unstructured ask in the owner's own words. */
  rawRequest: string;
  /** Host OS / chassis the work targets, e.g. "your operating system". */
  host?: string;
  /** Who requested it. Defaults to "owner". */
  requestedBy?: string;
  /** ISO timestamp. Injected by the caller (CLI) so the core stays
   *  deterministic and testable. */
  createdAt?: string;
}

export interface ForgeAssumptionSummary {
  whatIHeard: string;
  objective: string;
  inScope: string[];
  outOfScope: string[];
  assumptions: string[];
  expectedFiles: string[];
  riskGates: string[];
  successCheck: string;
  ownerDecisions: string[];
}

export interface ForgeMilestoneBuildPlan {
  objective: string;
  laneVerdict: ForgeLaneVerdict;
  steps: string[];
  expectedFiles: string[];
  guardrails: string[];
}

export interface ForgeReviewPacket {
  laneVerdict: ForgeLaneVerdict;
  securityChecklistRef: string;
  qaChecklistRef: string;
  promotionChecklistRef: string;
  security: string[];
  qa: string[];
  promotion: string[];
}

export interface ForgeEngagement {
  title: string;
  host: string;
  requestedBy: string;
  createdAt: string;
  rawRequest: string;
  gate: ForgeLaneGate;
  assumptionSummary: ForgeAssumptionSummary;
  buildPlan: ForgeMilestoneBuildPlan;
  reviewPacket: ForgeReviewPacket;
}

/** Universal guardrails injected into every build plan. These encode the
 *  bundling and checkpoint rules (operational requirements 7 and 8). */
const BUNDLING_RULE =
  'Bundle safe repo-local work into one cohesive milestone. Do not generate command-level approval spam for ordinary safe work (reading, searching, writing approved artifacts, tests, builds, typechecks).';
const CHECKPOINT_RULE =
  'Ask the owner only at real business-direction checkpoints: red-lane gates, paid-tool decisions, secrets, destructive changes, external account connections, git push, or a major architecture tradeoff. Not for every safe command.';

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Condense a raw request to a one-line objective: first sentence, capped. */
function condense(rawRequest: string, max = 160): string {
  const flat = collapse(rawRequest);
  if (!flat) return '(no request text provided)';
  const firstSentence = flat.split(/(?<=[.!?])\s/)[0] ?? flat;
  const base = firstSentence.length <= max ? firstSentence : flat.slice(0, max).trimEnd() + '…';
  return base;
}

function deriveTitle(request: ForgeEngagementRequest): string {
  if (request.title && request.title.trim()) return request.title.trim();
  const words = collapse(request.rawRequest).split(' ').slice(0, 8).join(' ');
  return words ? `Forge: ${words}` : 'Forge engagement';
}

/**
 * The lane gate. Scans the raw request for red-lane triggers and returns a
 * SAFE / STOP verdict plus every match. Deterministic and side-effect free.
 */
export function classifyLane(rawRequest: string): ForgeLaneGate {
  const text = rawRequest ?? '';
  const hits: RedLaneHit[] = [];
  const seen = new Set<string>();

  for (const rule of RED_LANE_RULES) {
    for (const pattern of rule.patterns) {
      const m = text.match(pattern);
      if (m && m[0]) {
        const matchedText = m[0].trim();
        const key = `${rule.category}:${matchedText.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push({ category: rule.category, label: rule.label, matchedText });
      }
    }
  }

  const categories = [...new Set(hits.map((h) => h.category))];
  const verdict: ForgeLaneVerdict = hits.length > 0 ? 'STOP' : 'SAFE';
  const notice =
    verdict === 'SAFE'
      ? 'No red-lane trigger detected. Safe to build inside Forge\'s repo-local lane with normal operator judgment.'
      : 'Red-lane trigger(s) detected. This request needs an owner-owned decision before Forge builds it.';

  return { verdict, hits, categories, notice };
}

export function buildAssumptionSummary(
  request: ForgeEngagementRequest,
  gate: ForgeLaneGate,
): ForgeAssumptionSummary {
  const objective = condense(request.rawRequest);
  const riskGates =
    gate.hits.length > 0
      ? gate.hits.map((h) => `${h.label}: "${h.matchedText}" (owner-owned)`)
      : ['None detected by the lane gate.'];
  const ownerDecisions =
    gate.verdict === 'STOP'
      ? gate.categories.map((c) => `Decide / authorize: ${labelFor(c)}.`)
      : ['None required to start safe-lane work.'];

  return {
    whatIHeard: collapse(request.rawRequest) || '(no request text provided)',
    objective,
    inScope: ['(operator: list the exact in-scope work)'],
    outOfScope: ['(operator: list what is explicitly excluded)'],
    assumptions: ['(operator: list each assumption that could change the build if wrong)'],
    expectedFiles: ['(operator: list the exact files expected to change)'],
    riskGates,
    successCheck: '(operator: define the concrete check that proves this milestone is done)',
    ownerDecisions,
  };
}

export function buildMilestonePlan(
  request: ForgeEngagementRequest,
  gate: ForgeLaneGate,
): ForgeMilestoneBuildPlan {
  const steps: string[] = [];
  if (gate.verdict === 'STOP') {
    steps.push('STOP: resolve the owner-owned red-lane decision(s) below before any build work.');
  }
  steps.push(
    'Inspect the active project\'s conventions first (Active Project Adapter).',
    'Confirm the Assumption Summary with the owner for anything non-trivial.',
    'Build the approved scope as one cohesive milestone.',
    'Run the host project\'s tests and typecheck/build.',
    'Run the Security Review on changed files only.',
    'Run the QA Review and make a clear PASS/FAIL call.',
    'Run the Promotion Review; stage only exact approved files (never git add .).',
    'Report to the owner and recommend the next milestone.',
  );

  return {
    objective: condense(request.rawRequest),
    laneVerdict: gate.verdict,
    steps,
    expectedFiles: ['(operator: enumerate the approved file set before building)'],
    guardrails: [
      BUNDLING_RULE,
      CHECKPOINT_RULE,
      'Stay inside the repo-local lane. No secrets, paid tools, installs, deletes, broad rewrites, or pushes without the owner.',
    ],
  };
}

export function buildReviewPacket(gate: ForgeLaneGate): ForgeReviewPacket {
  return {
    laneVerdict: gate.verdict,
    securityChecklistRef: 'landos-agents/forge/docs/Forge_Security_Checklist.md',
    qaChecklistRef: 'landos-agents/forge/docs/Forge_QA_Checklist.md',
    promotionChecklistRef: 'landos-agents/forge/docs/Forge_Promotion_Checklist.md',
    security: [
      'No secrets, tokens, or .env values added or printed in changed files.',
      'No new outbound network calls or out-of-scope filesystem writes.',
      'Any new dependency cleared through the open-source security pass (none added if not needed).',
    ],
    qa: [
      'Feature does what the Assumption Summary promised; success check passes.',
      'Host tests and typecheck/build run and reviewed.',
      'Nothing broke: discovery, dashboard, other agents unaffected.',
    ],
    promotion: [
      'Security PASS and QA PASS recorded.',
      'Staged file set equals the approved set, by explicit path.',
      'No push without the owner\'s explicit approval.',
    ],
  };
}

function labelFor(category: RedLaneCategory): string {
  const rule = RED_LANE_RULES.find((r) => r.category === category);
  return rule ? rule.label : category;
}

/**
 * Start a Forge engagement from a raw request. Returns the full structured
 * artifact. Deterministic: the only non-deterministic input (timestamp) is
 * supplied by the caller via request.createdAt.
 */
export function startForgeEngagement(request: ForgeEngagementRequest): ForgeEngagement {
  const gate = classifyLane(request.rawRequest);
  return {
    title: deriveTitle(request),
    host: request.host?.trim() || 'unspecified host',
    requestedBy: request.requestedBy?.trim() || 'owner',
    createdAt: request.createdAt?.trim() || 'unset',
    rawRequest: collapse(request.rawRequest),
    gate,
    assumptionSummary: buildAssumptionSummary(request, gate),
    buildPlan: buildMilestonePlan(request, gate),
    reviewPacket: buildReviewPacket(gate),
  };
}

function mdList(items: string[]): string {
  if (items.length === 0) return '- (none)';
  return items.map((i) => `- ${i}`).join('\n');
}

function mdChecklist(items: string[]): string {
  if (items.length === 0) return '- [ ] (none)';
  return items.map((i) => `- [ ] ${i}`).join('\n');
}

/**
 * Render a Forge engagement as a single Markdown artifact following the full
 * Forge rhythm. This is the reviewable operating document the owner gets back.
 */
export function renderEngagementMarkdown(engagement: ForgeEngagement): string {
  const e = engagement;
  const g = e.gate;

  const gateBlock =
    g.hits.length > 0
      ? g.hits.map((h) => `- **${h.label}** — matched \`${h.matchedText}\``).join('\n')
      : '- No red-lane triggers detected.';

  return `# Forge Engagement — ${e.title}

**Host:** ${e.host}
**Requested by:** ${e.requestedBy}
**Created:** ${e.createdAt}
**Lane verdict:** ${g.verdict}

---

## Lane Gate

${g.notice}

${gateBlock}

> The lane gate is a conservative triage aid, not a security boundary. STOP means an owner-owned decision is involved. SAFE means no trigger was detected; the operator still applies judgment.

---

## 1. Interview (raw request)

${e.rawRequest || '(no request text provided)'}

---

## 2. Assumption Summary

**What I heard:** ${e.assumptionSummary.whatIHeard}

**Objective:** ${e.assumptionSummary.objective}

**In scope:**
${mdList(e.assumptionSummary.inScope)}

**Out of scope:**
${mdList(e.assumptionSummary.outOfScope)}

**Assumptions:**
${mdList(e.assumptionSummary.assumptions)}

**Expected files changed:**
${mdList(e.assumptionSummary.expectedFiles)}

**Risk gates:**
${mdList(e.assumptionSummary.riskGates)}

**Success check:** ${e.assumptionSummary.successCheck}

**Owner decisions needed before build:**
${mdList(e.assumptionSummary.ownerDecisions)}

---

## 3. Milestone Build Plan

**Objective:** ${e.buildPlan.objective}
**Lane verdict:** ${e.buildPlan.laneVerdict}

**Steps:**
${e.buildPlan.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}

**Expected files:**
${mdList(e.buildPlan.expectedFiles)}

**Guardrails:**
${mdList(e.buildPlan.guardrails)}

---

## 4. Review Packet

**Security Review** (\`${e.reviewPacket.securityChecklistRef}\`):
${mdChecklist(e.reviewPacket.security)}

**QA Review** (\`${e.reviewPacket.qaChecklistRef}\`):
${mdChecklist(e.reviewPacket.qa)}

**Promotion Review** (\`${e.reviewPacket.promotionChecklistRef}\`):
${mdChecklist(e.reviewPacket.promotion)}

---

## 5. Owner Direction Review

${
    g.verdict === 'STOP'
      ? 'Forge needs these owner-owned decisions before building:\n' +
        mdList(e.assumptionSummary.ownerDecisions)
      : 'No red-lane decisions detected. Forge can proceed inside the safe repo-local lane once the Assumption Summary is confirmed.'
  }

---

## 6. Next Milestone

(operator: recommend the single best next milestone, with a one-line reason.)
`;
}
