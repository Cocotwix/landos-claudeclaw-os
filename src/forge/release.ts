// Forge security + release builder layer — pure Forge Core.
//
// Deterministic, dependency-free, host-neutral, business-neutral. Everything
// here is text/JSON generation: it classifies owner-owned gates and produces
// setup checklists, demo runbooks, and completion reports. It NEVER executes,
// connects, deploys, subscribes, pushes, reads env, or touches secrets. The
// owner runs the steps; Forge only describes them.
//
// This module exists because Forge is the builder and architecture operator,
// not a planning assistant. Forge builds as far as is safely possible, then
// stops at true owner-owned security/release gates and hands back a clear
// completed-product report with approve/tweak/reject options.

// ── Feature A: security / release gate classifier ────────────────────────

/** Release lanes, ordered least-to-most restrictive. The overall lane of a
 *  request is the most restrictive gate it touches. */
export type ReleaseLane =
  | 'forge_safe'
  | 'owner_setup_required'
  | 'release_approval_required'
  | 'blocked_until_credentials'
  | 'never_automate';

const LANE_SEVERITY: Record<ReleaseLane, number> = {
  forge_safe: 0,
  owner_setup_required: 1,
  release_approval_required: 2,
  blocked_until_credentials: 3,
  never_automate: 4,
};

interface GateRule {
  id: string;
  label: string;
  lane: ReleaseLane;
  ownerAction: string;
  /** Suggested .env.example-style key, placeholder value only. Optional. */
  envKey?: string;
  patterns: RegExp[];
}

const GATE_RULES: readonly GateRule[] = [
  {
    id: 'api_key',
    label: 'API key',
    lane: 'blocked_until_credentials',
    ownerAction: 'Add the API key to .env locally (never commit it).',
    envKey: 'PROVIDER_API_KEY',
    patterns: [/\bapi[\s_-]?keys?\b/i, /\bsecret\s+key\b/i, /\bapi\s+credentials?\b/i],
  },
  {
    id: 'oauth',
    label: 'OAuth credentials',
    lane: 'owner_setup_required',
    ownerAction: 'Create OAuth credentials and configure the redirect URL.',
    envKey: 'OAUTH_CLIENT_SECRET',
    patterns: [/\boauth\b/i, /\bclient[\s_-]?(id|secret)\b/i, /\bredirect\s+(uri|url)\b/i],
  },
  {
    id: 'billing_subscription',
    label: 'Billing / subscription',
    lane: 'owner_setup_required',
    ownerAction: 'Confirm billing and the subscription/plan with the provider.',
    patterns: [/\bbilling\b/i, /\bsubscriptions?\b/i, /\bsubscribe\b/i, /\bpaid\s+plan\b/i, /\binvoices?\b/i],
  },
  {
    id: 'production_deploy',
    label: 'Production deploy',
    lane: 'release_approval_required',
    ownerAction: 'Approve the production deploy.',
    patterns: [/\bdeploy\s+(to\s+)?(prod|production|live)\b/i, /\bgo\s+live\b/i, /\bship\s+to\s+prod\b/i, /\bproduction\s+release\b/i],
  },
  {
    id: 'domain_dns',
    label: 'Domain / DNS',
    lane: 'owner_setup_required',
    ownerAction: 'Verify the domain and configure DNS records.',
    patterns: [/\bdomains?\b/i, /\bdns\b/i, /\bnameservers?\b/i, /\bcname\b/i, /\bsubdomain\b/i],
  },
  {
    id: 'email_sms_provider',
    label: 'Email / SMS provider',
    lane: 'owner_setup_required',
    ownerAction: 'Create and configure the email/SMS provider account.',
    envKey: 'EMAIL_PROVIDER_API_KEY',
    patterns: [/\bemail\s+provider\b/i, /\bsmtp\b/i, /\bsms\b/i, /\btwilio\b/i, /\bsendgrid\b/i, /\bmailgun\b/i, /\bpostmark\b/i],
  },
  {
    id: 'database_credentials',
    label: 'Database credentials',
    lane: 'blocked_until_credentials',
    ownerAction: 'Supply the database connection credentials.',
    envKey: 'DATABASE_URL',
    patterns: [
      /\bdatabase\s+(credentials?|password|username|url|connection(\s+string)?)\b/i,
      /\bdb\s+(credentials?|password|username|url|connection(\s+string)?)\b/i,
      /\bconnection\s+string\b/i,
      /\b(postgres|postgresql|mysql|mongodb?)\s+(uri|url|connection)\b/i,
      /\b(database|postgres|postgresql|mysql)_url\b/i,
    ],
  },
  {
    id: 'real_customer_data',
    label: 'Real customer data',
    lane: 'never_automate',
    ownerAction: 'Owner must handle real customer/production data directly.',
    patterns: [/\breal\s+customer\s+data\b/i, /\bproduction\s+data\b/i, /\bcustomer\s+pii\b/i, /\blive\s+user\s+data\b/i],
  },
  {
    id: 'account_connection',
    label: 'Private account connection',
    lane: 'owner_setup_required',
    ownerAction: 'Connect the private account (owner-owned login).',
    patterns: [/\bconnect\s+(my|the|our|a|an)\s+[\w\s]*account\b/i, /\blink\s+(my|the|our)\s+[\w\s]*account\b/i, /\blog\s?in\s+to\b/i],
  },
  {
    id: 'push_release_approval',
    label: 'Push / release approval',
    lane: 'release_approval_required',
    ownerAction: 'Approve the git push / release.',
    patterns: [
      /\bgit\s+push\b/i,
      /\bpush\s+(to\s+)?(origin|remote|main|master|prod|production|github|gitlab|bitbucket)\b/i,
      /\bpush\s+[\w\s]+?\bto\s+(origin|remote|main|github|gitlab|bitbucket)\b/i,
      /\brelease\s+(this|to)\b/i,
      /\bpublish\s+(the\s+)?(package|release)\b/i,
      /\bpublish\s+to\s+(github|gitlab|bitbucket)\b/i,
    ],
  },
  {
    id: 'destructive',
    label: 'Destructive action',
    lane: 'never_automate',
    ownerAction: 'Owner must explicitly authorize any destructive action.',
    patterns: [/\bdeletes?\b/i, /\bdrop\s+(the\s+|a\s+)?(table|database)\b/i, /\bwipe\b/i, /\btruncate\b/i, /\brm\s+-rf\b/i],
  },
  {
    id: 'secret_handling',
    label: 'Secret handling',
    lane: 'blocked_until_credentials',
    ownerAction: 'Owner supplies and manages the secret; Forge never reads or stores it.',
    patterns: [/\bsecrets?\b/i, /\bcredentials?\b/i, /\bpasswords?\b/i, /\bjwts?\b/i, /\.env\b/i],
  },
  {
    id: 'paid_api_tool',
    label: 'Paid API / tool',
    lane: 'owner_setup_required',
    ownerAction: 'Approve and configure the paid API/tool (owner cost decision).',
    patterns: [/\bpaid\s+(api|apis|tool|tools|service)\b/i, /\bmetered\b/i, /\bstripe\b/i, /\bopenrouter\b/i],
  },
];

export interface SecurityGateHit {
  id: string;
  label: string;
  lane: ReleaseLane;
  ownerAction: string;
  envKey?: string;
  matchedText: string;
}

export interface SecurityGateResult {
  /** Most restrictive lane across all gates; forge_safe if none. */
  lane: ReleaseLane;
  /** False only when a never-automate gate is present. */
  forgeCanProceed: boolean;
  /** True when any non-safe owner gate is present. */
  needsOwner: boolean;
  gates: SecurityGateHit[];
  categories: string[];
  notice: string;
}

function laneNotice(lane: ReleaseLane): string {
  switch (lane) {
    case 'forge_safe':
      return 'No owner-owned gate detected. Forge can build and verify this locally.';
    case 'owner_setup_required':
      return 'Forge can build this, but the owner must supply setup (accounts/config) before it works end to end.';
    case 'release_approval_required':
      return 'Forge can build and prepare this. Release/push/deploy needs the owner\'s approval.';
    case 'blocked_until_credentials':
      return 'Forge can write the code, but it stays blocked from running end to end until the owner supplies credentials.';
    case 'never_automate':
      return 'This touches a never-automate action. Forge will not perform it; the owner must handle it directly.';
  }
}

/** Classify a raw build request into owner-owned security/release gates.
 *  Pure and deterministic. Text/JSON metadata only. */
export function classifySecurityGates(rawRequest: string): SecurityGateResult {
  const text = rawRequest ?? '';
  const gates: SecurityGateHit[] = [];
  const seen = new Set<string>();

  for (const rule of GATE_RULES) {
    for (const pattern of rule.patterns) {
      const m = text.match(pattern);
      if (m && m[0]) {
        const matchedText = m[0].trim();
        const key = `${rule.id}:${matchedText.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        gates.push({
          id: rule.id,
          label: rule.label,
          lane: rule.lane,
          ownerAction: rule.ownerAction,
          envKey: rule.envKey,
          matchedText,
        });
        break; // one hit per rule is enough
      }
    }
  }

  let lane: ReleaseLane = 'forge_safe';
  for (const g of gates) {
    if (LANE_SEVERITY[g.lane] > LANE_SEVERITY[lane]) lane = g.lane;
  }

  const categories = [...new Set(gates.map((g) => g.id))];
  return {
    lane,
    forgeCanProceed: lane !== 'never_automate',
    needsOwner: gates.length > 0,
    gates,
    categories,
    notice: laneNotice(lane),
  };
}

// ── shared helpers ───────────────────────────────────────────────────────

const PLACEHOLDER = '<fill in>';

function mdList(items: string[]): string {
  return items.length ? items.map((i) => `- ${i}`).join('\n') : `- ${PLACEHOLDER}`;
}

function mdChecklist(items: string[]): string {
  return items.length ? items.map((i) => `- [ ] ${i}`).join('\n') : `- [ ] ${PLACEHOLDER}`;
}

// ── Feature B: owner setup checklist generator ───────────────────────────

export interface SetupChecklistInput {
  title?: string;
  /** Gates from classifySecurityGates, if already computed. */
  gates?: SecurityGateHit[];
  /** Extra .env.example-style keys to surface (placeholder values only). */
  envKeys?: string[];
}

/** Build the owner setup checklist. Placeholders only. Never emits real
 *  secrets and never reads .env. */
export function generateSetupChecklist(input: SetupChecklistInput): string {
  const title = input.title?.trim() || 'Forge engagement';
  const gates = input.gates ?? [];

  const gateSteps = gates.map((g) => g.ownerAction);
  // Always include the standard owner-owned setup steps so nothing is missed.
  const standardSteps = [
    'Create any required provider account(s).',
    'Confirm billing / subscription if the provider charges.',
    'Add required keys to .env locally (never commit them).',
    'Configure OAuth redirect URL(s) if OAuth is used.',
    'Add webhook URL(s) if the integration needs callbacks.',
    'Verify domain / DNS if a custom domain is used.',
    'Run the local demo command to confirm it works.',
    'Approve the production deploy when ready (owner-owned).',
    'Confirm your decision: approve, tweak, reject, or hold.',
  ];

  const envKeys = new Set<string>(input.envKeys ?? []);
  for (const g of gates) if (g.envKey) envKeys.add(g.envKey);
  const envBlock = envKeys.size
    ? [...envKeys].map((k) => `${k}=<your-${k.toLowerCase().replace(/_/g, '-')}>`).join('\n')
    : '# (no provider keys detected for this build)';

  return `# Owner Setup Checklist — ${title}

These are the owner-owned steps Forge cannot do for you. Forge built everything
it safely could; this is what only you can supply.

## Required for this build
${mdChecklist(gateSteps)}

## Standard owner setup
${mdChecklist(standardSteps)}

## .env keys to add locally (placeholders — never commit real values)
\`\`\`
${envBlock}
\`\`\`

Forge never reads .env, never stores secrets, and never creates real
credentials. Replace each placeholder with your own value on your machine only.
`;
}

// ── Feature C: demo / trial runbook generator ────────────────────────────

export interface DemoRunbookInput {
  title?: string;
  startCommand?: string;
  openUrl?: string;
  steps?: string[];
  expectedResult?: string;
  missingSetupHint?: string;
}

/** Build a local proof / demo runbook. Host-neutral. Text only. */
export function generateDemoRunbook(input: DemoRunbookInput): string {
  const title = input.title?.trim() || 'Forge engagement';
  const startCommand = input.startCommand?.trim() || PLACEHOLDER;
  const openUrl = input.openUrl?.trim() || PLACEHOLDER;
  const steps = input.steps && input.steps.length ? input.steps : ['Open the app.', 'Trigger the new feature.', 'Confirm the expected result.'];
  const expected = input.expectedResult?.trim() || 'The new feature behaves as described, with no errors.';
  const missingHint = input.missingSetupHint?.trim() || 'An auth/credentials/connection error means owner setup is still missing (see the Owner Setup Checklist).';

  return `# Demo / Trial Runbook — ${title}

## How to start
\`\`\`
${startCommand}
\`\`\`

## Where to open
${openUrl}

## What to do
${mdList(steps)}

## Expected result
${expected}

## If you see an error
${missingHint}

## Safe to test locally
- Read-only views and the new feature's happy path.
- Anything that runs entirely on your machine with placeholder/test data.

## Do NOT test without owner approval
- Production deploys, live pushes, or real customer data.
- Anything that spends money, sends real email/SMS, or connects a live account.

Forge does not run this runbook for you. These are steps for you to perform.
`;
}

// ── Feature D: completion report generator ───────────────────────────────

export interface CompletionReportInput {
  title?: string;
  whatWasBuilt?: string[];
  workingCapabilities?: string[];
  filesChanged?: string[];
  testsRun?: string[];
  /** Security gate result; if omitted, treated as forge_safe. */
  security?: SecurityGateResult;
  ownerSetup?: string[];
  demoSteps?: string[];
  knownLimitations?: string[];
}

function releaseReadiness(lane: ReleaseLane): string {
  switch (lane) {
    case 'forge_safe':
      return 'Ready for local use and review.';
    case 'owner_setup_required':
      return 'Ready for review now; ready for real use once the owner completes setup.';
    case 'release_approval_required':
      return 'Ready for review and staging; production release needs the owner\'s approval.';
    case 'blocked_until_credentials':
      return 'Code complete; blocked from end-to-end use until the owner supplies credentials.';
    case 'never_automate':
      return 'On hold: contains an owner-owned action Forge will not perform.';
  }
}

/** Build the "Forge built it, owner decides" completion report. Pure. */
export function generateCompletionReport(input: CompletionReportInput): string {
  const title = input.title?.trim() || 'Forge engagement';
  const security = input.security;
  const lane = security?.lane ?? 'forge_safe';
  const gateLines = security && security.gates.length
    ? security.gates.map((g) => `${g.label} (${g.lane}): ${g.ownerAction}`)
    : ['None detected.'];
  const ownerSetup = input.ownerSetup && input.ownerSetup.length
    ? input.ownerSetup
    : security && security.gates.length
      ? security.gates.map((g) => g.ownerAction)
      : ['None required.'];

  return `# Forge Completion Report — ${title}

## 1. What was built
${mdList(input.whatWasBuilt ?? [])}

## 2. Working capabilities
${mdList(input.workingCapabilities ?? [])}

## 3. Files / areas changed
${mdList(input.filesChanged ?? [])}

## 4. Tests / builds run
${mdList(input.testsRun ?? [])}

## 5. Security / release gates found
${mdList(gateLines)}

## 6. Owner setup needed
${mdChecklist(ownerSetup)}

## 7. Demo / trial steps
${mdList(input.demoSteps ?? ['See the Demo / Trial Runbook.'])}

## 8. Known limitations
${mdList(input.knownLimitations ?? ['None noted.'])}

## 9. Release readiness
${releaseReadiness(lane)}

## 10. Owner decision
Choose one: approve, tweak, reject, or hold.
- approve: ship / push / use as built.
- tweak: keep going with specific changes.
- reject: do not proceed; discard this build.
- hold: pause until you decide.

Forge built as far as was safely possible and stopped at owner-owned gates. It
will not push, deploy, subscribe, connect accounts, or read secrets. Your call.
`;
}
