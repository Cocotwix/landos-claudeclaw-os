// Canonical verification planning. Only durable task/submission state and Git
// objects are inputs; worker path claims and mutable invocation files are not.

import { createHash } from 'node:crypto';

import { git } from '../dev/verify.mjs';
import { normalizePhysicalResource } from './resource-ownership.mjs';

export const VERIFICATION_POLICY_VERSION = 'landos-verification-v4';

// Permanent completion invariant: no LandOS build is complete until its result
// is visibly verified on the real operator application. Backend, API, test,
// build, and database evidence never substitute for this obligation.
export const BROWSER_VISUAL_ACCEPTANCE_OBLIGATION_ID = 'browser-visual-acceptance';
export const BROWSER_VISUAL_ACCEPTANCE_KIND = 'browser_visual_acceptance';
export const OPERATOR_APP_ORIGIN = 'localhost:3141';
export const BROWSER_VISUAL_ACCEPTANCE_FIELDS = Object.freeze([
  'surface', 'expected', 'visible_assertion', 'refresh', 'console', 'reruns', 'screenshot',
]);

// Fields whose recorded value must name the CONCRETE outcome that was on screen.
// Presence of a label proved only that a builder typed something; these two carry
// the claim itself, so a generic value here is a failed acceptance, not a PASS.
export const BROWSER_VISUAL_ACCEPTANCE_CONCRETE_FIELDS = Object.freeze(['visible_assertion', 'refresh']);

// Values that assert nothing about the build's own visible outcome. Each is
// matched against the WHOLE recorded value, so a real assertion that happens to
// mention a screenshot or a count is unaffected; only a value that says no more
// than this is refused.
export const GENERIC_VISUAL_EVIDENCE_PATTERNS = Object.freeze([
  /^page (?:loaded|loads|rendered|renders|opened|opens)$/,
  /^(?:http )?\d{3}(?: ok)?$/,
  /^(?:the )?(?:ui|page|surface|section|component)(?: is)? (?:visible|rendered|renders|present|fine|ok)$/,
  /^(?:it |the )?(?:feature|build|fix|change)?\s*works(?: as expected)?$/,
  /^\d+ (?:records?|rows?|results?|items?|comps?) (?:returned|found|present|exist|existed)$/,
  /^database rows exist(?:ed)?$/,
  /^(?:db|database) (?:rows?|records?) (?:exist|existed|present|returned)$/,
  /^screenshot (?:captured|taken|saved|attached)$/,
  /^(?:api|endpoint|backend|server)(?: response)? (?:ok|200|returned data|works)$/,
  /^(?:verified|confirmed|passed|pass|ok|done|green|good|looks good|no errors|clean)$/,
  /^no (?:console )?errors$/,
  /^tests? (?:pass|passed|green)$/,
]);

/**
 * Extract one labeled field's recorded value (`field=…` / `field: …`), or null.
 *
 * The value ends at the NEXT labeled field or the end of the line, never at the
 * first punctuation: a real assertion reads "Brush Creek Rd; 40.2 ac; $900,000",
 * so splitting on `;` would truncate the very detail the gate exists to demand.
 */
export function readAcceptanceField(text, field) {
  const nextLabel = `(?:${BROWSER_VISUAL_ACCEPTANCE_FIELDS.join('|')})\\s*[=:]`;
  const match = new RegExp(
    `(?:^|[\\s;,|(])${field}\\s*[=:]\\s*([^\\n]*?)(?=\\s*(?:[;,|]\\s*)?${nextLabel}|\\n|$)`,
    'i',
  ).exec(String(text ?? ''));
  if (!match) return null;
  const value = match[1].replace(/^["'\s]+|["'\s;,|]+$/g, '').trim();
  return value || null;
}

/**
 * Why a recorded acceptance value fails to state a concrete visible outcome, or
 * null when it does. A concrete claim carries a specific token the operator
 * could have read off the screen: a number, a money figure, or a stated code or
 * status word ("PASS", "RS-15"). Prose alone ("the page looked right") does not.
 */
export function genericVisualEvidenceReason(value) {
  const text = String(value ?? '').trim();
  if (!text) return 'is empty';
  const normalized = text.toLowerCase().replace(/[.!;·—–-]+$/g, '').replace(/\s+/g, ' ').trim();
  if (GENERIC_VISUAL_EVIDENCE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return `is the generic claim "${text}", which states no outcome specific to this build`;
  }
  if (text.length < 12) return `is too short ("${text}") to state what was visibly proven`;
  const hasConcreteSignal = /\d/.test(text) || /\b[A-Z][A-Z0-9/_-]{1,}\b/.test(text) || /["'“”]/.test(text);
  if (!hasConcreteSignal) {
    return `names no concrete on-screen value ("${text}"): state the visible text, figure, or status the surface showed`;
  }
  return null;
}

/**
 * The one shared refusal set for a browser-visual-acceptance PASS. Both the
 * Control DB manual-review path and the sprint ledger call this, so a claim
 * refused on one path can never be accepted on the other.
 */
export function browserVisualAcceptanceEvidenceRefusals(text) {
  const body = String(text ?? '');
  const refusals = [];
  const missing = BROWSER_VISUAL_ACCEPTANCE_FIELDS.filter((field) => readAcceptanceField(body, field) == null);
  if (missing.length > 0) {
    refusals.push(
      `missing labeled evidence field(s) ${missing.map((field) => `${field}=`).join(', ')}: record the operator surface `
      + 'tested, the expected visible outcome, the concrete visible assertion actually verified, the hard-refresh '
      + 'result, the console result, the unintended-rerun check, and the screenshot location',
    );
  }
  for (const field of BROWSER_VISUAL_ACCEPTANCE_CONCRETE_FIELDS) {
    const value = readAcceptanceField(body, field);
    if (value == null) continue;
    const reason = genericVisualEvidenceReason(value);
    if (reason) refusals.push(`${field}= ${reason}`);
  }
  if (!body.includes(OPERATOR_APP_ORIGIN)) {
    refusals.push(`the live operator surface URL on ${OPERATOR_APP_ORIGIN} is not recorded`);
  }
  return refusals;
}

export const BROWSER_VISUAL_ACCEPTANCE_SUMMARY = 'Mandatory browser visual acceptance on the live operator application at '
  + `http://${OPERATOR_APP_ORIGIN}: open the real operator surface the build affected, visually verify the actual `
  + 'changed behavior or data, hard refresh and verify it remains, check the console for new errors, confirm the page '
  + 'load did not rerun research/model/browser workflows unintentionally, and capture screenshot or recorded page-text '
  + 'evidence. A PASS review must record labeled evidence fields: '
  + `${BROWSER_VISUAL_ACCEPTANCE_FIELDS.map((field) => `${field}=`).join(' ')}. `
  + 'visible_assertion= and refresh= must name the concrete on-screen outcome this build was supposed to produce; '
  + 'generic claims ("page loaded", "HTTP 200", "UI visible", "feature works", "N records returned", "database rows '
  + 'exist", "screenshot captured") are refused.';

const CAPABILITIES_PATH = '.landos/capabilities.json';
const CONTROL_SPINE_PATHS = Object.freeze([
  '.landos/CODING_SESSION_PROTOCOL.md',
  '.landos/PERMANENT_MEMORY.md',
  '.landos/capabilities.json',
  '.landos/CHECKPOINT.md',
  '.landos/verification-results.json',
  'AGENTS.md',
  'CLAUDE.md',
  'docs/landos/development-control-spine.md',
  'scripts/control',
  'scripts/dev/providers.mjs',
  'scripts/dev/task.mjs',
  'scripts/dev/task.test.mjs',
  'scripts/memory/landos-memory.mjs',
  'package.json',
]);
const ARCHITECTURE_COMMANDS = Object.freeze([
  'npm run landos:control:test',
  'npm run landos:task:test',
  'npm run typecheck',
  'npm run build',
]);
const RISK_RANK = Object.freeze({ low: 0, protected: 1, 'architecture-critical': 2 });

function required(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}

function exactSha(value, label) {
  const sha = required(value, label).toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`${label} must be an exact 40-character Git SHA`);
  return sha;
}

function strings(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))].sort();
}

function resourceRequirements(value, label) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  const normalized = value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`${label}[${index}] must be a canonical resource descriptor`);
    }
    const resourceType = required(item.resourceType, `${label}[${index}] resource type`);
    const endpoint = required(item.endpoint, `${label}[${index}] endpoint`);
    const physical = normalizePhysicalResource({ resourceType, endpoint });
    return Object.freeze({
      resourceId: required(item.resourceId, `${label}[${index}] resource ID`),
      resourceType,
      endpoint,
      normalizedIdentity: physical.identity,
    });
  });
  return normalized.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function pathFamilyMatches(candidate, family) {
  const pathname = String(candidate).replace(/\\/g, '/').replace(/^\.\//, '');
  const prefix = String(family).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
  if (!prefix) return false;
  if (!prefix.includes('*')) return pathname === prefix || pathname.startsWith(`${prefix}/`);
  const escaped = prefix.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*');
  return new RegExp(`^${escaped}(?:/.*)?$`).test(pathname);
}

function gitFile(root, gitSha, relativePath) {
  const result = git(['show', `${gitSha}:${relativePath}`], root);
  if (result.status !== 0) throw new Error(`verification policy requires ${relativePath} at exact commit ${gitSha}`);
  return result.stdout;
}

function capabilityBaseline(root, policyGitSha) {
  let parsed;
  try { parsed = JSON.parse(gitFile(root, policyGitSha, CAPABILITIES_PATH)); }
  catch (error) {
    throw new Error(`cannot read exact-commit ${CAPABILITIES_PATH}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(parsed.capabilities)) throw new Error('exact-commit capabilities must be an array');
  return parsed.capabilities;
}

function higherRisk(left, right) {
  if (!(left in RISK_RANK) || !(right in RISK_RANK)) throw new Error(`unsupported verification risk ${left}/${right}`);
  return RISK_RANK[left] >= RISK_RANK[right] ? left : right;
}

function executableObligation(id, kind, command, summary, { capabilityId = null, resources = [] } = {}) {
  return Object.freeze({
    id,
    capabilityId,
    kind,
    obligationType: 'EXECUTABLE',
    command: required(command, `${id} command`),
    summary,
    mandatory: true,
    resources: resourceRequirements(resources, `${id} resources`),
  });
}

function manualReviewObligation(id, kind, summary) {
  return Object.freeze({
    id,
    capabilityId: null,
    kind,
    obligationType: 'MANUAL_REVIEW',
    command: null,
    summary,
    mandatory: true,
    resources: Object.freeze([]),
  });
}

export function actualChangedPaths(root, baseGitSha, candidateGitSha) {
  const result = git(['diff', '--name-only', '-z', baseGitSha, candidateGitSha], root);
  if (result.status !== 0) {
    throw new Error(`Control Spine could not compute actual Git diff ${baseGitSha}..${candidateGitSha}: ${result.stderr.trim() || result.stdout.trim()}`);
  }
  return [...new Set(result.stdout.split('\0').map((item) => item.replace(/\\/g, '/').trim()).filter(Boolean))].sort();
}

export function deriveVerificationPlan(root, input) {
  const baseGitSha = exactSha(input.baseGitSha, 'verification base SHA');
  const candidateGitSha = exactSha(input.candidateGitSha, 'verification candidate SHA');
  const policyGitSha = exactSha(input.policyGitSha, 'verification policy SHA');
  const taskContract = input.taskContract;
  if (!taskContract || typeof taskContract !== 'object') throw new Error('canonical task contract is required for verification planning');
  const submissionBundle = input.submissionBundle;
  if (!submissionBundle || typeof submissionBundle !== 'object') throw new Error('persisted normalized Submission Bundle is required for verification planning');
  if (submissionBundle.candidateGitSha !== candidateGitSha || submissionBundle.workingBaseGitSha !== baseGitSha) {
    throw new Error('Submission Bundle Git identities do not match the internally observed verification range');
  }

  const actualPaths = actualChangedPaths(root, baseGitSha, candidateGitSha);
  const capabilities = capabilityBaseline(root, policyGitSha);
  const touched = capabilities.filter((capability) => {
    const families = strings(
      capability.protectedPaths ?? capability.sharedDependencyPaths ?? [],
      `capability ${capability.id} protected paths`,
    );
    return actualPaths.some((pathname) => families.some((family) => pathFamilyMatches(pathname, family)));
  }).sort((left, right) => String(left.id).localeCompare(String(right.id)));

  let risk = required(taskContract.riskPolicy, 'canonical task risk policy');
  if (!(risk in RISK_RANK)) throw new Error(`unsupported canonical task risk policy ${risk}`);
  if (touched.length) risk = higherRisk(risk, 'protected');
  if (actualPaths.some((pathname) => CONTROL_SPINE_PATHS.some((family) => pathFamilyMatches(pathname, family)))) {
    risk = 'architecture-critical';
  }

  const canonicalInput = {
    taskId: required(taskContract.taskId, 'task contract task ID'),
    objective: required(taskContract.objective, 'task objective'),
    nonGoals: strings(taskContract.nonGoals, 'task non-goals'),
    acceptedBaseGitSha: exactSha(taskContract.acceptedBaseGitSha, 'task accepted base'),
    workingBaseGitSha: exactSha(taskContract.workingBaseGitSha, 'task working base'),
    riskPolicy: taskContract.riskPolicy,
    acceptancePolicy: required(taskContract.acceptancePolicy, 'task acceptance policy'),
    architectureRefs: strings(taskContract.architectureRefs, 'task architecture refs'),
    invariantRefs: strings(taskContract.invariantRefs, 'task invariant refs'),
    ownedScope: strings(taskContract.ownedScope, 'task owned scope'),
    ownedInterfaces: strings(taskContract.ownedInterfaces, 'task owned interfaces'),
    verificationObligations: strings(taskContract.verificationObligations, 'task verification obligations'),
    verificationPolicyRefs: strings(taskContract.verificationPolicyRefs, 'task verification policy refs'),
    runtimeConstraints: strings(taskContract.runtimeConstraints, 'task runtime constraints'),
    resourceConstraints: strings(taskContract.resourceConstraints, 'task resource constraints'),
    policyGitSha,
  };
  if (canonicalInput.workingBaseGitSha !== baseGitSha) throw new Error('canonical task working base does not match verification base');
  if (canonicalInput.verificationObligations.length === 0) throw new Error('canonical task contract requires verification obligations');

  const bundleInput = {
    id: Number(submissionBundle.id),
    executionId: required(submissionBundle.executionId, 'Submission Bundle execution ID'),
    provider: required(submissionBundle.provider, 'Submission Bundle provider'),
    changedPaths: strings(submissionBundle.changedPaths, 'Submission Bundle changed paths'),
    implementationClaims: strings(submissionBundle.implementationClaims, 'Submission Bundle claims'),
    workerTests: strings(submissionBundle.workerTests, 'Submission Bundle worker tests'),
    workerTestResults: strings(submissionBundle.workerTestResults, 'Submission Bundle worker test results'),
    limitations: strings(submissionBundle.limitations, 'Submission Bundle limitations'),
    evidenceReferences: strings(submissionBundle.evidenceReferences, 'Submission Bundle evidence references'),
  };
  const canonicalInputDigest = digest(canonicalInput);
  const submissionBundleDigest = digest(bundleInput);
  const obligations = [
    executableObligation('actual-git-diff', 'actual_git_diff', `git diff --check ${baseGitSha} ${candidateGitSha}`, 'Internally calculated base-to-candidate Git diff has no whitespace errors.'),
    manualReviewObligation('canonical-task-contract', 'canonical_input_review', 'A named reviewer must review the canonical objective, non-goals, invariants, scope, constraints, and acceptance policy.'),
    manualReviewObligation('submission-bundle-evidence', 'submission_evidence_review', 'A named reviewer must review normalized implementation claims, worker evidence, and limitations without treating them as verification results.'),
    manualReviewObligation(BROWSER_VISUAL_ACCEPTANCE_OBLIGATION_ID, BROWSER_VISUAL_ACCEPTANCE_KIND, BROWSER_VISUAL_ACCEPTANCE_SUMMARY),
  ];
  for (const capability of touched) {
    for (const [index, command] of strings(capability.verificationCommands ?? capability.requiredVerification ?? [], `capability ${capability.id} commands`).entries()) {
      obligations.push(executableObligation(
        `capability:${capability.id}:${index}`,
        'capability',
        command,
        `Exact-commit policy requires verification for ${capability.name ?? capability.id}.`,
        { capabilityId: String(capability.id), resources: capability.verificationResources ?? [] },
      ));
    }
  }
  if (risk === 'architecture-critical') {
    for (const [index, command] of ARCHITECTURE_COMMANDS.entries()) {
      obligations.push(executableObligation(`control-spine:${index}`, 'control_spine_architecture', command, 'Architecture-critical development-control verification is mandatory.'));
    }
  }
  const deduplicated = obligations.filter((item, index) => obligations.findIndex((other) => (
    item.obligationType === 'EXECUTABLE'
      ? other.obligationType === item.obligationType && other.command === item.command
      : other.id === item.id
  )) === index);
  if (deduplicated.length === 0) throw new Error('governed code verification plan requires at least one mandatory obligation');

  return Object.freeze({
    schema: 3,
    policyVersion: VERIFICATION_POLICY_VERSION,
    baseGitSha,
    candidateGitSha,
    policyGitSha,
    actualChangedPaths: actualPaths,
    touchedCapabilities: touched.map((capability) => String(capability.id)),
    risk,
    canonicalInputDigest,
    submissionBundleId: bundleInput.id,
    submissionBundleDigest,
    planningInputs: Object.freeze({ taskContract: stable(canonicalInput), submissionBundle: stable(bundleInput) }),
    obligations: deduplicated.map((item) => Object.freeze(item)),
  });
}
