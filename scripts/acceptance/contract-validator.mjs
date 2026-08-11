import { readFile } from 'node:fs/promises';

import { EXPECTED_BINDINGS, resolveExpectedBinding } from './contract-builder.mjs';

export const ACCEPTANCE_SCHEMA_VERSION = '1.0.0';

export const REQUIRED_ARTIFACTS = Object.freeze([
  'acceptance-contract.json',
  'acceptance-report.md',
  'results.json',
  'new-lead.png',
  'deal-card-loaded.png',
  'changed-section.png',
  'relevant-tab-or-panel.png',
  'after-refresh.png',
  'after-restart.png',
  'trace.zip',
  'video.webm',
  'console.json',
  'network-failures.json',
]);

export const SCREENSHOT_ARTIFACTS = Object.freeze([
  'new-lead.png',
  'deal-card-loaded.png',
  'changed-section.png',
  'relevant-tab-or-panel.png',
  'after-refresh.png',
  'after-restart.png',
]);

export const CAPTURE_ARTIFACTS = Object.freeze([
  ...SCREENSHOT_ARTIFACTS,
  'trace.zip',
  'video.webm',
  'console.json',
  'network-failures.json',
]);

const COMPARISONS = new Set(['equals', 'count_equals', 'contains', 'present', 'absent', 'no_contamination']);
const CHECK_RESULTS = new Set(['PASS', 'FAIL']);
const MODES = new Set(['fixture', 'live']);
const ENTRY_FLOWS = new Set(['new-lead', 'existing-deal']);
const CONTENT_KINDS = new Set(['screenshot', 'trace', 'video', 'console', 'network']);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value, allowed, path, errors) {
  if (!isObject(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(`${path}.${key}: unexpected property`);
  }
}

function requireKeys(value, required, path, errors) {
  if (!isObject(value)) {
    errors.push(`${path}: expected object`);
    return false;
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) errors.push(`${path}.${key}: required property is missing`);
  }
  return true;
}

function requireString(value, path, errors, minimum = 1) {
  if (typeof value !== 'string' || value.trim().length < minimum) {
    errors.push(`${path}: expected a non-empty string of at least ${minimum} characters`);
    return false;
  }
  return true;
}

function requireBoolean(value, path, errors) {
  if (typeof value !== 'boolean') {
    errors.push(`${path}: expected boolean`);
    return false;
  }
  return true;
}

function requireInteger(value, path, errors, minimum = 0) {
  if (!Number.isInteger(value) || value < minimum) {
    errors.push(`${path}: expected integer >= ${minimum}`);
    return false;
  }
  return true;
}

function requireIsoTimestamp(value, path, errors) {
  if (!requireString(value, path, errors)) return false;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    errors.push(`${path}: expected canonical ISO-8601 UTC timestamp`);
    return false;
  }
  return true;
}

function requirePrimitive(value, path, errors) {
  if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) {
    errors.push(`${path}: expected a JSON primitive`);
    return false;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    errors.push(`${path}: expected a finite number`);
    return false;
  }
  return true;
}

function requireStringArray(value, path, errors, { allowEmpty = true } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    errors.push(`${path}: expected ${allowEmpty ? 'an' : 'a non-empty'} array`);
    return false;
  }
  const seen = new Set();
  value.forEach((entry, index) => {
    if (!requireString(entry, `${path}[${index}]`, errors)) return;
    if (seen.has(entry)) errors.push(`${path}[${index}]: duplicate value ${JSON.stringify(entry)}`);
    seen.add(entry);
  });
  return true;
}

function exactSet(value, expected, path, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${path}: expected array`);
    return;
  }
  const actual = new Set(value);
  const wanted = new Set(expected);
  if (value.length !== expected.length || actual.size !== wanted.size) {
    errors.push(`${path}: expected exactly ${expected.join(', ')}`);
    return;
  }
  for (const item of wanted) {
    if (!actual.has(item)) errors.push(`${path}: missing ${item}`);
  }
  for (const item of actual) {
    if (!wanted.has(item)) errors.push(`${path}: unexpected ${String(item)}`);
  }
}

function validateCheck(value, path, errors) {
  const required = ['status', 'visibleValuesRetained', 'timestamp'];
  if (!requireKeys(value, required, path, errors)) return;
  hasOnlyKeys(value, required, path, errors);
  if (!CHECK_RESULTS.has(value.status)) errors.push(`${path}.status: expected PASS or FAIL`);
  requireBoolean(value.visibleValuesRetained, `${path}.visibleValuesRetained`, errors);
  requireIsoTimestamp(value.timestamp, `${path}.timestamp`, errors);
}

export function validateAcceptanceContract(contract) {
  const errors = [];
  const rootKeys = [
    'schemaVersion', 'contractId', 'sprintName', 'createdAt', 'independentAuthority',
    'property', 'expectations', 'runPolicy', 'claims', 'requiredArtifacts',
  ];
  if (!requireKeys(contract, rootKeys, 'contract', errors)) return errors;
  hasOnlyKeys(contract, rootKeys, 'contract', errors);
  if (contract.schemaVersion !== ACCEPTANCE_SCHEMA_VERSION) {
    errors.push(`contract.schemaVersion: expected ${ACCEPTANCE_SCHEMA_VERSION}`);
  }
  requireString(contract.contractId, 'contract.contractId', errors, 3);
  requireString(contract.sprintName, 'contract.sprintName', errors, 3);
  requireIsoTimestamp(contract.createdAt, 'contract.createdAt', errors);
  if (contract.independentAuthority !== 'landos-visual-qa') {
    errors.push('contract.independentAuthority: independent acceptance must be owned by landos-visual-qa');
  }

  const propertyKeys = ['address', 'normalizedAddress', 'apn', 'canonicalPropertyId', 'canonicalCounts'];
  if (requireKeys(contract.property, propertyKeys, 'contract.property', errors)) {
    hasOnlyKeys(contract.property, propertyKeys, 'contract.property', errors);
    requireString(contract.property.address, 'contract.property.address', errors, 5);
    requireString(contract.property.normalizedAddress, 'contract.property.normalizedAddress', errors, 5);
    requireString(contract.property.apn, 'contract.property.apn', errors);
    requireString(contract.property.canonicalPropertyId, 'contract.property.canonicalPropertyId', errors);
    if (requireKeys(contract.property.canonicalCounts, ['comps', 'visuals'], 'contract.property.canonicalCounts', errors)) {
      hasOnlyKeys(contract.property.canonicalCounts, ['comps', 'visuals'], 'contract.property.canonicalCounts', errors);
      requireInteger(contract.property.canonicalCounts.comps, 'contract.property.canonicalCounts.comps', errors);
      requireInteger(contract.property.canonicalCounts.visuals, 'contract.property.canonicalCounts.visuals', errors);
    }
  }

  const expectationKeys = ['imageryAvailable', 'specialistResultsRendered', 'noCrossPropertyContamination'];
  if (requireKeys(contract.expectations, expectationKeys, 'contract.expectations', errors)) {
    hasOnlyKeys(contract.expectations, expectationKeys, 'contract.expectations', errors);
    requireBoolean(contract.expectations.imageryAvailable, 'contract.expectations.imageryAvailable', errors);
    requireBoolean(contract.expectations.specialistResultsRendered, 'contract.expectations.specialistResultsRendered', errors);
    if (contract.expectations.noCrossPropertyContamination !== true) {
      errors.push('contract.expectations.noCrossPropertyContamination: must be true');
    }
  }

  const policyKeys = [
    'mode', 'entryFlow', 'freshnessRequired', 'requireRefresh', 'requireRestart',
    'requireIsolatedContext', 'requireContextCleanup', 'authState',
    'requiredNetworkPatterns', 'allowedConsoleErrorPatterns',
  ];
  if (requireKeys(contract.runPolicy, policyKeys, 'contract.runPolicy', errors)) {
    hasOnlyKeys(contract.runPolicy, policyKeys, 'contract.runPolicy', errors);
    if (!MODES.has(contract.runPolicy.mode)) errors.push('contract.runPolicy.mode: expected fixture or live');
    if (!ENTRY_FLOWS.has(contract.runPolicy.entryFlow)) errors.push('contract.runPolicy.entryFlow: expected new-lead or existing-deal');
    requireBoolean(contract.runPolicy.freshnessRequired, 'contract.runPolicy.freshnessRequired', errors);
    for (const key of ['requireRefresh', 'requireRestart', 'requireIsolatedContext', 'requireContextCleanup']) {
      if (contract.runPolicy[key] !== true) errors.push(`contract.runPolicy.${key}: must be true`);
    }
    const authKeys = ['importAllowed', 'explicitApprovalRequired', 'repositoryPersistenceProhibited'];
    if (requireKeys(contract.runPolicy.authState, authKeys, 'contract.runPolicy.authState', errors)) {
      hasOnlyKeys(contract.runPolicy.authState, authKeys, 'contract.runPolicy.authState', errors);
      requireBoolean(contract.runPolicy.authState.importAllowed, 'contract.runPolicy.authState.importAllowed', errors);
      if (contract.runPolicy.authState.explicitApprovalRequired !== true) {
        errors.push('contract.runPolicy.authState.explicitApprovalRequired: must be true');
      }
      if (contract.runPolicy.authState.repositoryPersistenceProhibited !== true) {
        errors.push('contract.runPolicy.authState.repositoryPersistenceProhibited: must be true');
      }
    }
    requireStringArray(contract.runPolicy.requiredNetworkPatterns, 'contract.runPolicy.requiredNetworkPatterns', errors);
    requireStringArray(contract.runPolicy.allowedConsoleErrorPatterns, 'contract.runPolicy.allowedConsoleErrorPatterns', errors);
  }

  if (!Array.isArray(contract.claims) || contract.claims.length === 0) {
    errors.push('contract.claims: expected at least one predeclared visible claim');
  } else {
    const claimIds = new Set();
    const claimKeys = ['id', 'operatorSection', 'claim', 'expectedBinding', 'expectedValue', 'comparison', 'canonicalSource', 'evidenceArtifacts'];
    contract.claims.forEach((claim, index) => {
      const path = `contract.claims[${index}]`;
      if (!requireKeys(claim, claimKeys, path, errors)) return;
      hasOnlyKeys(claim, claimKeys, path, errors);
      requireString(claim.id, `${path}.id`, errors, 3);
      if (!/^[a-z0-9][a-z0-9-]{2,80}$/.test(claim.id ?? '')) errors.push(`${path}.id: expected stable kebab-case identifier`);
      if (claimIds.has(claim.id)) errors.push(`${path}.id: duplicate claim id ${claim.id}`);
      claimIds.add(claim.id);
      requireString(claim.operatorSection, `${path}.operatorSection`, errors, 2);
      requireString(claim.claim, `${path}.claim`, errors, 5);
      if (!EXPECTED_BINDINGS.includes(claim.expectedBinding)) errors.push(`${path}.expectedBinding: unsupported semantic binding`);
      requirePrimitive(claim.expectedValue, `${path}.expectedValue`, errors);
      if (EXPECTED_BINDINGS.includes(claim.expectedBinding)) {
        const boundValue = resolveExpectedBinding(contract, claim.expectedBinding);
        if (!Object.is(boundValue, claim.expectedValue)) errors.push(`${path}.expectedValue: contradicts ${claim.expectedBinding}`);
      }
      if (!COMPARISONS.has(claim.comparison)) errors.push(`${path}.comparison: unsupported comparison`);
      requireString(claim.canonicalSource, `${path}.canonicalSource`, errors, 3);
      if (requireStringArray(claim.evidenceArtifacts, `${path}.evidenceArtifacts`, errors, { allowEmpty: false })) {
        for (const artifact of claim.evidenceArtifacts) {
          if (!SCREENSHOT_ARTIFACTS.includes(artifact)) errors.push(`${path}.evidenceArtifacts: ${artifact} is not a required screenshot`);
        }
      }
    });
  }
  exactSet(contract.requiredArtifacts, REQUIRED_ARTIFACTS, 'contract.requiredArtifacts', errors);
  return errors;
}

export function validateAcceptanceResults(results) {
  const errors = [];
  const rootKeys = [
    'schemaVersion', 'runId', 'contractId', 'sprintName', 'mode', 'startedAt', 'completedAt',
    'propertyAddress', 'authStateImported', 'freshness', 'claims', 'counts', 'lifecycle',
    'refresh', 'restart', 'contamination', 'console', 'network', 'artifacts', 'verdict',
  ];
  if (!requireKeys(results, rootKeys, 'results', errors)) return errors;
  hasOnlyKeys(results, rootKeys, 'results', errors);
  if (results.schemaVersion !== ACCEPTANCE_SCHEMA_VERSION) errors.push(`results.schemaVersion: expected ${ACCEPTANCE_SCHEMA_VERSION}`);
  requireString(results.runId, 'results.runId', errors, 3);
  requireString(results.contractId, 'results.contractId', errors, 3);
  requireString(results.sprintName, 'results.sprintName', errors, 3);
  if (!MODES.has(results.mode)) errors.push('results.mode: expected fixture or live');
  const startOk = requireIsoTimestamp(results.startedAt, 'results.startedAt', errors);
  const endOk = requireIsoTimestamp(results.completedAt, 'results.completedAt', errors);
  if (startOk && endOk && Date.parse(results.completedAt) < Date.parse(results.startedAt)) {
    errors.push('results.completedAt: cannot precede startedAt');
  }
  requireString(results.propertyAddress, 'results.propertyAddress', errors, 5);
  requireBoolean(results.authStateImported, 'results.authStateImported', errors);

  const freshnessKeys = ['required', 'isFresh', 'evidence'];
  if (requireKeys(results.freshness, freshnessKeys, 'results.freshness', errors)) {
    hasOnlyKeys(results.freshness, freshnessKeys, 'results.freshness', errors);
    requireBoolean(results.freshness.required, 'results.freshness.required', errors);
    requireBoolean(results.freshness.isFresh, 'results.freshness.isFresh', errors);
    requireString(results.freshness.evidence, 'results.freshness.evidence', errors, 3);
  }

  const claimKeys = [
    'claimId', 'operatorSection', 'propertyAddress', 'claim', 'expectedValue', 'visibleValue',
    'status', 'evidencePath', 'timestamp', 'refreshResult', 'restartResult', 'contaminationResult',
  ];
  if (!Array.isArray(results.claims) || results.claims.length === 0) {
    errors.push('results.claims: expected at least one claim result');
  } else {
    const seen = new Set();
    results.claims.forEach((claim, index) => {
      const path = `results.claims[${index}]`;
      if (!requireKeys(claim, claimKeys, path, errors)) return;
      hasOnlyKeys(claim, claimKeys, path, errors);
      requireString(claim.claimId, `${path}.claimId`, errors, 3);
      if (seen.has(claim.claimId)) errors.push(`${path}.claimId: duplicate claim result`);
      seen.add(claim.claimId);
      requireString(claim.operatorSection, `${path}.operatorSection`, errors, 2);
      requireString(claim.propertyAddress, `${path}.propertyAddress`, errors, 5);
      requireString(claim.claim, `${path}.claim`, errors, 5);
      requirePrimitive(claim.expectedValue, `${path}.expectedValue`, errors);
      requirePrimitive(claim.visibleValue, `${path}.visibleValue`, errors);
      if (!CHECK_RESULTS.has(claim.status)) errors.push(`${path}.status: expected PASS or FAIL`);
      if (!SCREENSHOT_ARTIFACTS.includes(claim.evidencePath)) errors.push(`${path}.evidencePath: expected required screenshot path`);
      requireIsoTimestamp(claim.timestamp, `${path}.timestamp`, errors);
      for (const key of ['refreshResult', 'restartResult', 'contaminationResult']) {
        if (!CHECK_RESULTS.has(claim[key])) errors.push(`${path}.${key}: expected PASS or FAIL`);
      }
    });
  }

  const countKeys = ['operatorSection', 'label', 'canonicalAccepted', 'displayed', 'renderedRows', 'emptyStateVisible', 'timestamp'];
  if (!Array.isArray(results.counts) || results.counts.length === 0) {
    errors.push('results.counts: expected at least one visible count observation');
  } else {
    results.counts.forEach((count, index) => {
      const path = `results.counts[${index}]`;
      if (!requireKeys(count, countKeys, path, errors)) return;
      hasOnlyKeys(count, countKeys, path, errors);
      requireString(count.operatorSection, `${path}.operatorSection`, errors, 2);
      requireString(count.label, `${path}.label`, errors, 2);
      requireInteger(count.canonicalAccepted, `${path}.canonicalAccepted`, errors);
      requireInteger(count.displayed, `${path}.displayed`, errors);
      requireInteger(count.renderedRows, `${path}.renderedRows`, errors);
      requireBoolean(count.emptyStateVisible, `${path}.emptyStateVisible`, errors);
      requireIsoTimestamp(count.timestamp, `${path}.timestamp`, errors);
    });
  }

  const lifecycleKeys = [
    'isolatedContext', 'contextsCreated', 'contextsClosed', 'pagesCreated', 'pagesClosed',
    'normalOperatorBrowserUntouched', 'cleanupCompleted', 'verifiedAt',
  ];
  if (requireKeys(results.lifecycle, lifecycleKeys, 'results.lifecycle', errors)) {
    hasOnlyKeys(results.lifecycle, lifecycleKeys, 'results.lifecycle', errors);
    requireBoolean(results.lifecycle.isolatedContext, 'results.lifecycle.isolatedContext', errors);
    requireInteger(results.lifecycle.contextsCreated, 'results.lifecycle.contextsCreated', errors, 1);
    requireInteger(results.lifecycle.contextsClosed, 'results.lifecycle.contextsClosed', errors);
    requireInteger(results.lifecycle.pagesCreated, 'results.lifecycle.pagesCreated', errors, 1);
    requireInteger(results.lifecycle.pagesClosed, 'results.lifecycle.pagesClosed', errors);
    requireBoolean(results.lifecycle.normalOperatorBrowserUntouched, 'results.lifecycle.normalOperatorBrowserUntouched', errors);
    requireBoolean(results.lifecycle.cleanupCompleted, 'results.lifecycle.cleanupCompleted', errors);
    requireIsoTimestamp(results.lifecycle.verifiedAt, 'results.lifecycle.verifiedAt', errors);
  }
  validateCheck(results.refresh, 'results.refresh', errors);
  validateCheck(results.restart, 'results.restart', errors);

  const contaminationKeys = ['status', 'detectedValues', 'timestamp'];
  if (requireKeys(results.contamination, contaminationKeys, 'results.contamination', errors)) {
    hasOnlyKeys(results.contamination, contaminationKeys, 'results.contamination', errors);
    if (!CHECK_RESULTS.has(results.contamination.status)) errors.push('results.contamination.status: expected PASS or FAIL');
    requireStringArray(results.contamination.detectedValues, 'results.contamination.detectedValues', errors);
    requireIsoTimestamp(results.contamination.timestamp, 'results.contamination.timestamp', errors);
  }

  const consoleKeys = ['path', 'relevantErrorCount', 'timestamp'];
  if (requireKeys(results.console, consoleKeys, 'results.console', errors)) {
    hasOnlyKeys(results.console, consoleKeys, 'results.console', errors);
    if (results.console.path !== 'console.json') errors.push('results.console.path: expected console.json');
    requireInteger(results.console.relevantErrorCount, 'results.console.relevantErrorCount', errors);
    requireIsoTimestamp(results.console.timestamp, 'results.console.timestamp', errors);
  }
  const networkKeys = ['path', 'requiredFailureCount', 'timestamp'];
  if (requireKeys(results.network, networkKeys, 'results.network', errors)) {
    hasOnlyKeys(results.network, networkKeys, 'results.network', errors);
    if (results.network.path !== 'network-failures.json') errors.push('results.network.path: expected network-failures.json');
    requireInteger(results.network.requiredFailureCount, 'results.network.requiredFailureCount', errors);
    requireIsoTimestamp(results.network.timestamp, 'results.network.timestamp', errors);
  }

  const artifactKeys = ['path', 'mediaType', 'byteLength', 'sha256', 'capturedAt', 'contentValidation'];
  if (!Array.isArray(results.artifacts) || results.artifacts.length < CAPTURE_ARTIFACTS.length) {
    errors.push(`results.artifacts: expected metadata for all ${CAPTURE_ARTIFACTS.length} captured artifacts`);
  } else {
    const seen = new Set();
    results.artifacts.forEach((artifact, index) => {
      const path = `results.artifacts[${index}]`;
      if (!requireKeys(artifact, artifactKeys, path, errors)) return;
      hasOnlyKeys(artifact, artifactKeys, path, errors);
      requireString(artifact.path, `${path}.path`, errors, 3);
      if (seen.has(artifact.path)) errors.push(`${path}.path: duplicate artifact metadata`);
      seen.add(artifact.path);
      requireString(artifact.mediaType, `${path}.mediaType`, errors, 3);
      requireInteger(artifact.byteLength, `${path}.byteLength`, errors, 1);
      if (typeof artifact.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(artifact.sha256)) errors.push(`${path}.sha256: expected lowercase SHA-256`);
      requireIsoTimestamp(artifact.capturedAt, `${path}.capturedAt`, errors);
      const contentKeys = ['validated', 'kind', 'width', 'height', 'uniqueColorSamples'];
      if (requireKeys(artifact.contentValidation, ['validated', 'kind'], `${path}.contentValidation`, errors)) {
        hasOnlyKeys(artifact.contentValidation, contentKeys, `${path}.contentValidation`, errors);
        if (artifact.contentValidation.validated !== true) errors.push(`${path}.contentValidation.validated: must be true`);
        if (!CONTENT_KINDS.has(artifact.contentValidation.kind)) errors.push(`${path}.contentValidation.kind: unsupported kind`);
        if (artifact.contentValidation.kind === 'screenshot') {
          requireInteger(artifact.contentValidation.width, `${path}.contentValidation.width`, errors, 1);
          requireInteger(artifact.contentValidation.height, `${path}.contentValidation.height`, errors, 1);
          requireInteger(artifact.contentValidation.uniqueColorSamples, `${path}.contentValidation.uniqueColorSamples`, errors, 1);
        }
      }
    });
    exactSet([...seen], CAPTURE_ARTIFACTS, 'results.artifacts[].path', errors);
  }
  if (!CHECK_RESULTS.has(results.verdict)) errors.push('results.verdict: expected PASS or FAIL');
  return errors;
}

export function evaluateComparison(comparison, expectedValue, visibleValue) {
  switch (comparison) {
    case 'equals':
      return Object.is(expectedValue, visibleValue);
    case 'count_equals':
      return Number.isInteger(expectedValue) && Number.isInteger(visibleValue) && expectedValue === visibleValue;
    case 'contains':
      return typeof expectedValue === 'string'
        && typeof visibleValue === 'string'
        && visibleValue.toLocaleLowerCase('en-US').includes(expectedValue.toLocaleLowerCase('en-US'));
    case 'present':
      return visibleValue !== null && visibleValue !== false && visibleValue !== '' && visibleValue !== 0;
    case 'absent':
      return visibleValue === null || visibleValue === false || visibleValue === '' || visibleValue === 0;
    case 'no_contamination':
      return visibleValue === true;
    default:
      return false;
  }
}

export async function readJsonFile(path) {
  const text = await readFile(path, 'utf8');
  return JSON.parse(text);
}

export function formatValidationErrors(label, errors) {
  return errors.map((error) => `${label}: ${error}`);
}
