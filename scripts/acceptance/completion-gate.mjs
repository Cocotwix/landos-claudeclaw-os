import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';

import {
  CAPTURE_ARTIFACTS,
  REQUIRED_ARTIFACTS,
  SCREENSHOT_ARTIFACTS,
  evaluateComparison,
  formatValidationErrors,
  validateAcceptanceContract,
  validateAcceptanceResults,
} from './contract-validator.mjs';
import {
  inspectConsoleCapture,
  inspectDecodedWebm,
  inspectNetworkCapture,
  inspectPng,
  inspectTraceZip,
  inspectWebm,
  sha256,
} from './artifact-inspector.mjs';
import { resolveExpectedBinding } from './contract-builder.mjs';
import { inspectPlaywrightTrace, valuesForPhase, valuesFromTrace } from './trace-evidence.mjs';
import { inspectTraceRedaction } from './trace-sanitizer.mjs';

const SENSITIVE_LOG_PATTERN = /(?:authorization|cookie|set-cookie|bearer\s+[a-z0-9._~+\/-]+|(?:token|secret|password|api[_-]?key)\s*[:=]\s*[^\s"']+|eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,})/i;
const REPOSITORY_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
let schemaValidatorsPromise;

function canonicalIsoTimestamp(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

async function schemaValidators() {
  schemaValidatorsPromise ??= (async () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    ajv.addFormat('date-time', { type: 'string', validate: canonicalIsoTimestamp });
    const [contractSchema, resultsSchema] = await Promise.all([
      readFile(join(REPOSITORY_ROOT, 'config', 'acceptance', 'acceptance-contract.schema.json'), 'utf8').then(JSON.parse),
      readFile(join(REPOSITORY_ROOT, 'config', 'acceptance', 'results.schema.json'), 'utf8').then(JSON.parse),
    ]);
    return {
      contract: ajv.compile(contractSchema),
      results: ajv.compile(resultsSchema),
    };
  })();
  return schemaValidatorsPromise;
}

function ajvErrors(label, validator) {
  return (validator.errors ?? []).map((error) => `${label} schema ${error.instancePath || '/'} ${error.message}`);
}

function samePrimitive(left, right) {
  return typeof left === typeof right && Object.is(left, right);
}

function inside(base, target) {
  const rel = relative(base, target);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

function timestampWithin(value, start, end) {
  const instant = Date.parse(value);
  return Number.isFinite(instant) && instant >= Date.parse(start) && instant <= Date.parse(end) + 60_000;
}

async function loadRequiredFile(directory, name, errors) {
  const target = resolve(directory, name);
  if (!inside(directory, target)) {
    errors.push(`${name}: artifact path escaped the package directory`);
    return null;
  }
  try {
    const stat = await lstat(target);
    if (stat.isSymbolicLink()) {
      errors.push(`${name}: symbolic links are not accepted as evidence artifacts`);
      return null;
    }
    if (!stat.isFile()) {
      errors.push(`${name}: required artifact is not a regular file`);
      return null;
    }
    if (stat.size === 0) {
      errors.push(`${name}: required artifact is empty`);
      return null;
    }
    return await readFile(target);
  } catch (error) {
    errors.push(`${name}: required artifact is missing or unreadable (${error instanceof Error ? error.message : String(error)})`);
    return null;
  }
}

function validateReportContent(report, contract, results, errors) {
  const text = report.toString('utf8');
  const requiredFragments = [
    '# LandOS Visual Acceptance Report',
    `Contract: \`${results.contractId}\``,
    `Property: ${results.propertyAddress}`,
    `Completed: ${results.completedAt}`,
    `Verdict: **${results.verdict}**`,
    '`trace.zip`',
    '`video.webm`',
  ];
  for (const fragment of requiredFragments) {
    if (!text.includes(fragment)) errors.push(`acceptance-report.md: missing current result content ${JSON.stringify(fragment)}`);
  }
  for (const claim of contract.claims) {
    if (!text.includes(claim.id)) errors.push(`acceptance-report.md: missing claim ${claim.id}`);
  }
}

function validateSecretSafety(consoleCapture, networkCapture, errors) {
  const consoleText = JSON.stringify(consoleCapture);
  const networkText = JSON.stringify(networkCapture);
  if (SENSITIVE_LOG_PATTERN.test(consoleText)) errors.push('console.json: possible credential, cookie, token, or secret content was persisted');
  if (SENSITIVE_LOG_PATTERN.test(networkText)) errors.push('network-failures.json: possible credential, cookie, token, or secret content was persisted');
}

export async function validateAcceptancePackage(packageDirectory) {
  const errors = [];
  const directory = resolve(packageDirectory);
  try {
    const stat = await lstat(directory);
    if (!stat.isDirectory()) return { ok: false, directory, errors: ['acceptance package path is not a directory'] };
    if (stat.isSymbolicLink()) return { ok: false, directory, errors: ['acceptance package directory may not be a symbolic link'] };
    const canonical = await realpath(directory);
    if (canonical !== directory) errors.push('acceptance package path must be canonical and may not traverse a link');
    const entries = await readdir(directory, { withFileTypes: true });
    const actualNames = entries.map((entry) => entry.name).sort();
    const expectedNames = [...REQUIRED_ARTIFACTS].sort();
    for (const entry of entries) {
      if (!REQUIRED_ARTIFACTS.includes(entry.name)) errors.push(`${entry.name}: unexpected acceptance package entry`);
      if (!entry.isFile()) errors.push(`${entry.name}: acceptance package entries must be regular files, not directories or links`);
    }
    for (const name of expectedNames) {
      if (!actualNames.includes(name)) errors.push(`${name}: required acceptance package entry is missing`);
    }
    if (actualNames.length !== expectedNames.length) {
      errors.push(`acceptance package must contain exactly ${expectedNames.length} regular files; found ${actualNames.length}`);
    }
  } catch (error) {
    return { ok: false, directory, errors: [`acceptance package directory is missing or unreadable (${error instanceof Error ? error.message : String(error)})`] };
  }

  const buffers = new Map();
  for (const name of REQUIRED_ARTIFACTS) buffers.set(name, await loadRequiredFile(directory, name, errors));
  if (errors.length > 0) return { ok: false, directory, errors };

  let contract;
  let results;
  let consoleCapture;
  let networkCapture;
  for (const [name, assign] of [
    ['acceptance-contract.json', (value) => { contract = value; }],
    ['results.json', (value) => { results = value; }],
    ['console.json', (value) => { consoleCapture = value; }],
    ['network-failures.json', (value) => { networkCapture = value; }],
  ]) {
    try {
      assign(JSON.parse(buffers.get(name).toString('utf8')));
    } catch (error) {
      errors.push(`${name}: invalid JSON (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  if (!contract || !results || !consoleCapture || !networkCapture) return { ok: false, directory, errors };

  const validators = await schemaValidators();
  if (!validators.contract(contract)) errors.push(...ajvErrors('contract', validators.contract));
  if (!validators.results(results)) errors.push(...ajvErrors('results', validators.results));
  errors.push(...formatValidationErrors('contract', validateAcceptanceContract(contract)));
  errors.push(...formatValidationErrors('results', validateAcceptanceResults(results)));
  if (errors.length > 0) return { ok: false, directory, errors };

  if (results.contractId !== contract.contractId) errors.push('results.contractId does not match acceptance-contract.json');
  if (results.sprintName !== contract.sprintName) errors.push('results.sprintName does not match acceptance-contract.json');
  if (results.mode !== contract.runPolicy.mode) errors.push('results.mode does not match the acceptance contract run mode');
  if (results.propertyAddress !== contract.property.normalizedAddress) errors.push('results.propertyAddress does not match the acceptance property');
  if (results.freshness.required !== contract.runPolicy.freshnessRequired) errors.push('results.freshness.required contradicts the acceptance contract');
  if (contract.runPolicy.freshnessRequired && !results.freshness.isFresh) errors.push('acceptance property is not fresh although freshness is required');

  const contractClaims = new Map(contract.claims.map((claim) => [claim.id, claim]));
  const resultClaims = new Map(results.claims.map((claim) => [claim.claimId, claim]));
  if (contractClaims.size !== resultClaims.size) errors.push('claim result count does not match the predeclared acceptance contract');
  for (const [claimId, claim] of contractClaims) {
    const result = resultClaims.get(claimId);
    if (!result) {
      errors.push(`claim ${claimId}: no result was recorded`);
      continue;
    }
    if (result.propertyAddress !== contract.property.normalizedAddress) errors.push(`claim ${claimId}: property address does not match the acceptance property`);
    if (result.claim !== claim.claim) errors.push(`claim ${claimId}: result text differs from the predeclared claim`);
    if (result.operatorSection !== claim.operatorSection) errors.push(`claim ${claimId}: operator section differs from the predeclared claim`);
    const boundExpectedValue = resolveExpectedBinding(contract, claim.expectedBinding);
    if (!samePrimitive(boundExpectedValue, claim.expectedValue)) errors.push(`claim ${claimId}: contract expected value contradicts ${claim.expectedBinding}`);
    if (!samePrimitive(result.expectedValue, claim.expectedValue)) errors.push(`claim ${claimId}: expected value differs from the predeclared contract`);
    if (!claim.evidenceArtifacts.includes(result.evidencePath)) errors.push(`claim ${claimId}: evidence path ${result.evidencePath} was not predeclared for the claim`);
    if (!timestampWithin(result.timestamp, results.startedAt, results.completedAt)) errors.push(`claim ${claimId}: timestamp falls outside the run`);
    const computedPass = evaluateComparison(claim.comparison, claim.expectedValue, result.visibleValue);
    if ((computedPass ? 'PASS' : 'FAIL') !== result.status) errors.push(`claim ${claimId}: ${result.status} contradicts expected/visible values`);
    if (result.status !== 'PASS') errors.push(`claim ${claimId}: visual claim verdict is FAIL`);
    if (result.refreshResult !== 'PASS') errors.push(`claim ${claimId}: refresh result is FAIL`);
    if (result.restartResult !== 'PASS') errors.push(`claim ${claimId}: restart result is FAIL`);
    if (result.contaminationResult !== 'PASS') errors.push(`claim ${claimId}: contamination result is FAIL`);
  }
  for (const claimId of resultClaims.keys()) {
    if (!contractClaims.has(claimId)) errors.push(`claim ${claimId}: result was not declared before the run`);
  }

  const expectedCanonical = {
    comps: contract.property.canonicalCounts.comps,
    visuals: contract.property.canonicalCounts.visuals,
  };
  let sawComps = false;
  let sawVisuals = false;
  for (const count of results.counts) {
    const isComp = /comp/i.test(`${count.operatorSection} ${count.label}`);
    const isVisual = /visual|imagery|evidence/i.test(`${count.operatorSection} ${count.label}`);
    if (isComp) {
      sawComps = true;
      if (count.canonicalAccepted !== expectedCanonical.comps) errors.push(`${count.operatorSection}/${count.label}: canonical comp count does not match contract`);
    }
    if (isVisual) {
      sawVisuals = true;
      if (count.canonicalAccepted !== expectedCanonical.visuals) errors.push(`${count.operatorSection}/${count.label}: canonical visual count does not match contract`);
    }
    if (count.displayed !== count.renderedRows) errors.push(`${count.operatorSection}/${count.label}: displayed count ${count.displayed} differs from ${count.renderedRows} rendered rows`);
    if (count.canonicalAccepted !== count.displayed) errors.push(`${count.operatorSection}/${count.label}: ${count.canonicalAccepted} canonical accepted records but ${count.displayed} displayed`);
    if (count.canonicalAccepted > 0 && count.emptyStateVisible) errors.push(`${count.operatorSection}/${count.label}: empty state is visible despite accepted canonical records`);
    if (!timestampWithin(count.timestamp, results.startedAt, results.completedAt)) errors.push(`${count.operatorSection}/${count.label}: count timestamp falls outside the run`);
  }
  if (!sawComps) errors.push('results.counts: no Comps & Market count comparison was recorded');
  if (!sawVisuals) errors.push('results.counts: no Documents & Visuals count comparison was recorded');

  if (!results.lifecycle.isolatedContext) errors.push('browser lifecycle: run did not use an isolated context');
  if (!results.lifecycle.normalOperatorBrowserUntouched) errors.push('browser lifecycle: normal operator browser was not proven untouched');
  if (!results.lifecycle.cleanupCompleted) errors.push('browser lifecycle: cleanup was not completed');
  if (results.lifecycle.contextsCreated !== results.lifecycle.contextsClosed) errors.push(`browser lifecycle: ${results.lifecycle.contextsCreated - results.lifecycle.contextsClosed} test context(s) remain open`);
  if (results.lifecycle.pagesCreated !== results.lifecycle.pagesClosed) errors.push(`browser lifecycle: ${results.lifecycle.pagesCreated - results.lifecycle.pagesClosed} test page(s) remain open`);
  if (results.refresh.status !== 'PASS' || !results.refresh.visibleValuesRetained) errors.push('refresh lost visible acceptance data');
  if (results.restart.status !== 'PASS' || !results.restart.visibleValuesRetained) errors.push('restart lost visible acceptance data');
  if (results.contamination.status !== 'PASS' || results.contamination.detectedValues.length > 0) errors.push('cross-property contamination was detected');

  const consoleInspection = inspectConsoleCapture(consoleCapture, {
    allowedErrorPatterns: contract.runPolicy.allowedConsoleErrorPatterns,
    startedAt: results.startedAt,
    completedAt: results.completedAt,
  });
  errors.push(...consoleInspection.errors.map((error) => `console.json: ${error}`));
  if (consoleInspection.relevantErrorCount !== results.console.relevantErrorCount) errors.push('console.json relevant error count does not match results.json');
  const networkInspection = inspectNetworkCapture(networkCapture, {
    requiredNetworkPatterns: contract.runPolicy.requiredNetworkPatterns,
    startedAt: results.startedAt,
    completedAt: results.completedAt,
  });
  errors.push(...networkInspection.errors.map((error) => `network-failures.json: ${error}`));
  if (networkInspection.requiredFailureCount !== results.network.requiredFailureCount) errors.push('required network failure count does not match results.json');
  if (networkInspection.requiredFailureCount > 0) errors.push(`${networkInspection.requiredFailureCount} required network request(s) failed`);
  validateSecretSafety(consoleCapture, networkCapture, errors);

  const metadata = new Map(results.artifacts.map((artifact) => [artifact.path, artifact]));
  let traceEvidence;
  for (const name of CAPTURE_ARTIFACTS) {
    const artifact = metadata.get(name);
    const buffer = buffers.get(name);
    if (!artifact) {
      errors.push(`${name}: artifact metadata is missing`);
      continue;
    }
    if (artifact.byteLength !== buffer.length) errors.push(`${name}: byte length does not match results metadata`);
    if (artifact.sha256 !== sha256(buffer)) errors.push(`${name}: SHA-256 does not match results metadata`);
    if (!timestampWithin(artifact.capturedAt, results.startedAt, results.completedAt)) errors.push(`${name}: capture timestamp falls outside the run`);
    if (SCREENSHOT_ARTIFACTS.includes(name)) {
      const inspection = inspectPng(buffer);
      errors.push(...inspection.errors.map((error) => `${name}: ${error}`));
      if (artifact.contentValidation.kind !== 'screenshot') errors.push(`${name}: metadata kind is not screenshot`);
      if (artifact.contentValidation.width !== inspection.width || artifact.contentValidation.height !== inspection.height) errors.push(`${name}: declared dimensions do not match PNG content`);
      if (artifact.contentValidation.uniqueColorSamples !== inspection.uniqueColorSamples) errors.push(`${name}: declared color diversity does not match PNG content`);
    } else if (name === 'trace.zip') {
      const inspection = inspectTraceZip(buffer);
      errors.push(...inspection.errors.map((error) => `${name}: ${error}`));
      const redactionInspection = inspectTraceRedaction(buffer);
      errors.push(...redactionInspection.errors.map((error) => `${name}: ${error}`));
      traceEvidence = inspectPlaywrightTrace(buffer, { contract, results });
      errors.push(...traceEvidence.errors.map((error) => `${name}: ${error}`));
      if (artifact.contentValidation.kind !== 'trace') errors.push(`${name}: metadata kind is not trace`);
    } else if (name === 'video.webm') {
      const inspection = inspectWebm(buffer);
      errors.push(...inspection.errors.map((error) => `${name}: ${error}`));
      const decodedInspection = await inspectDecodedWebm(join(directory, name));
      errors.push(...decodedInspection.errors.map((error) => `${name}: ${error}`));
      if (artifact.contentValidation.kind !== 'video') errors.push(`${name}: metadata kind is not video`);
    } else if (name === 'console.json' && artifact.contentValidation.kind !== 'console') errors.push(`${name}: metadata kind is not console`);
    else if (name === 'network-failures.json' && artifact.contentValidation.kind !== 'network') errors.push(`${name}: metadata kind is not network`);
  }

  for (const claim of results.claims) {
    const screenshot = metadata.get(claim.evidencePath);
    if (!screenshot || screenshot.contentValidation.kind !== 'screenshot') {
      errors.push(`claim ${claim.claimId}: required visual evidence is missing`);
    }
  }

  if (traceEvidence) {
    const traceValues = valuesFromTrace(contract, traceEvidence.observations);
    for (const [claimId, claim] of contractClaims) {
      const result = resultClaims.get(claimId);
      const visibleValue = traceValues.get(claimId);
      if (!result) continue;
      if (!samePrimitive(result.visibleValue, visibleValue)) errors.push(`claim ${claimId}: visible value does not match the trace-recorded rendered DOM`);
      const tracePass = evaluateComparison(claim.comparison, claim.expectedValue, visibleValue);
      if ((tracePass ? 'PASS' : 'FAIL') !== result.status) errors.push(`claim ${claimId}: verdict contradicts the trace-recorded rendered DOM`);
    }

    const changed = traceEvidence.observations.find((observation) => observation.artifact === 'changed-section.png');
    const relevant = traceEvidence.observations.find((observation) => observation.artifact === 'relevant-tab-or-panel.png');
    const compResult = results.counts.find((count) => /comp/i.test(`${count.operatorSection} ${count.label}`));
    const visualResult = results.counts.find((count) => /visual|imagery|evidence/i.test(`${count.operatorSection} ${count.label}`));
    for (const [label, recorded, rendered] of [
      ['Comps & Market', compResult, changed?.comps],
      ['Documents & Visuals', visualResult, relevant?.visuals],
    ]) {
      if (!recorded || !rendered) continue;
      if (recorded.displayed !== rendered.displayed || recorded.renderedRows !== rendered.renderedRows || recorded.emptyStateVisible !== rendered.emptyStateVisible) {
        errors.push(`${label}: results count does not match the trace-recorded rendered section`);
      }
    }

    const contamination = traceEvidence.contamination ?? [];
    const recordedContamination = [...results.contamination.detectedValues].sort();
    if (JSON.stringify(recordedContamination) !== JSON.stringify([...contamination].sort())) errors.push('results.contamination does not match trace-rendered subject/evidence identities');
    const initialValues = traceValues;
    for (const [phase, artifact, check] of [
      ['refresh', 'after-refresh.png', results.refresh],
      ['restart', 'after-restart.png', results.restart],
    ]) {
      const observation = traceEvidence.observations.find((entry) => entry.artifact === artifact);
      if (!observation) continue;
      const phaseValues = valuesForPhase(contract, observation, contamination);
      const retained = [...initialValues].every(([claimId, value]) => samePrimitive(value, phaseValues.get(claimId)));
      if (check.visibleValuesRetained !== retained || check.status !== (retained ? 'PASS' : 'FAIL')) errors.push(`${phase}: results contradict trace-recorded visible retention`);
      for (const [claimId, initialValue] of initialValues) {
        const claimResult = resultClaims.get(claimId);
        if (!claimResult) continue;
        const expectedPhaseResult = samePrimitive(initialValue, phaseValues.get(claimId)) ? 'PASS' : 'FAIL';
        if (claimResult[`${phase}Result`] !== expectedPhaseResult) errors.push(`claim ${claimId}: ${phase} result contradicts trace-recorded rendered DOM`);
      }
    }
    if (results.lifecycle.pagesCreated !== traceEvidence.lifecycle?.pagesCreated || results.lifecycle.pagesClosed !== traceEvidence.lifecycle?.pagesClosed) {
      errors.push('browser lifecycle page counts contradict the Playwright trace');
    }
  }

  validateReportContent(buffers.get('acceptance-report.md'), contract, results, errors);
  if (results.verdict !== 'PASS') errors.push(`visual verdict is ${results.verdict}, not PASS`);
  const allClaimsPass = results.claims.every((claim) => claim.status === 'PASS');
  if ((allClaimsPass ? 'PASS' : 'FAIL') !== results.verdict) errors.push('top-level verdict contradicts the claim verdicts');

  return { ok: errors.length === 0, directory, contractId: contract.contractId, runId: results.runId, verdict: results.verdict, errors };
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const packageDirectory = process.argv[2];
  if (!packageDirectory) {
    process.stderr.write('Usage: node scripts/acceptance/completion-gate.mjs <acceptance-package-directory>\n');
    process.exitCode = 2;
  } else {
    const result = await validateAcceptancePackage(packageDirectory);
    if (result.ok) {
      process.stdout.write(`PASS ${result.runId}: acceptance evidence content is complete and internally consistent.\n`);
    } else {
      process.stderr.write(`FAIL ${result.runId ?? 'unknown-run'}: completion gate blocked.\n`);
      for (const error of result.errors) process.stderr.write(`- ${error}\n`);
      process.exitCode = 1;
    }
  }
}
