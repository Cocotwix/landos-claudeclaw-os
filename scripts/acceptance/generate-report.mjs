import { rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  formatValidationErrors,
  readJsonFile,
  validateAcceptanceContract,
  validateAcceptanceResults,
} from './contract-validator.mjs';

function markdownValue(value) {
  if (typeof value === 'string') return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
  return JSON.stringify(value).replaceAll('|', '\\|');
}

export function renderAcceptanceReport(contract, results) {
  const failures = results.claims.filter((claim) => claim.status === 'FAIL');
  const gateState = results.verdict === 'PASS' ? 'ELIGIBLE FOR COMPLETION-GATE REVIEW' : 'BLOCKED';
  const lines = [
    '# LandOS Visual Acceptance Report',
    '',
    `Contract: \`${results.contractId}\``,
    '',
    `Run: \`${results.runId}\``,
    '',
    `Property: ${results.propertyAddress}`,
    '',
    `Completed: ${results.completedAt}`,
    '',
    `Verdict: **${results.verdict}**`,
    '',
    `Completion gate state: **${gateState}**`,
    '',
    '> Independent authority: landos-visual-qa. Canonical reads support comparison; they never override an operator-visible failure.',
    '',
    '## Claim results',
    '',
    '| Claim ID | Operator-facing section | Claim | Expected | Visible | Result | Evidence | Refresh | Restart | Contamination | Timestamp |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...results.claims.map((claim) => `| ${claim.claimId} | ${markdownValue(claim.operatorSection)} | ${markdownValue(claim.claim)} | ${markdownValue(claim.expectedValue)} | ${markdownValue(claim.visibleValue)} | **${claim.status}** | \`${claim.evidencePath}\` | ${claim.refreshResult} | ${claim.restartResult} | ${claim.contaminationResult} | ${claim.timestamp} |`),
    '',
    '## Visible counts',
    '',
    '| Section | Count | Canonical accepted | Displayed | Rendered rows | Empty state | Timestamp |',
    '| --- | --- | ---: | ---: | ---: | --- | --- |',
    ...results.counts.map((count) => `| ${markdownValue(count.operatorSection)} | ${markdownValue(count.label)} | ${count.canonicalAccepted} | ${count.displayed} | ${count.renderedRows} | ${count.emptyStateVisible ? 'visible' : 'not visible'} | ${count.timestamp} |`),
    '',
    '## Run integrity',
    '',
    `- Freshness: ${results.freshness.required ? (results.freshness.isFresh ? 'PASS' : 'FAIL') : 'not required for this known-target contract'} — ${results.freshness.evidence}`,
    `- Refresh: ${results.refresh.status}; visible values retained: ${results.refresh.visibleValuesRetained}`,
    `- Restart: ${results.restart.status}; visible values retained: ${results.restart.visibleValuesRetained}`,
    `- Contamination: ${results.contamination.status}; detected values: ${results.contamination.detectedValues.length}`,
    `- Browser isolation: ${results.lifecycle.isolatedContext ? 'PASS' : 'FAIL'}; contexts ${results.lifecycle.contextsClosed}/${results.lifecycle.contextsCreated} closed; pages ${results.lifecycle.pagesClosed}/${results.lifecycle.pagesCreated} closed`,
    `- Console: ${results.console.relevantErrorCount} relevant errors (\`${results.console.path}\`)`,
    `- Required network failures: ${results.network.requiredFailureCount} (\`${results.network.path}\`)`,
    `- Trace: \`trace.zip\``,
    `- Video: \`video.webm\``,
    '',
    '## Defect handoff',
    '',
  ];
  if (failures.length === 0) {
    lines.push('No operator-visible claim failed. The separate read-only completion gate must still pass before the sprint is treated as complete.');
  } else {
    for (const failure of failures) {
      lines.push(`- **${failure.claimId} — ${failure.operatorSection}:** expected ${markdownValue(failure.expectedValue)}; visible ${markdownValue(failure.visibleValue)}. Screenshot: \`${failure.evidencePath}\`; trace: \`trace.zip\`; console/network: \`${results.console.path}\`, \`${results.network.path}\`.`);
    }
    lines.push('', 'The implementation role may use this report as a defect input. It may not change this verdict or certify its own repair; the full acceptance workflow must be rerun.');
  }
  lines.push('', '## Evidence package', '', ...contract.requiredArtifacts.map((path) => `- \`${path}\``), '');
  return `${lines.join('\n')}\n`;
}

export async function generateAcceptanceReport(packageDirectory) {
  const directory = resolve(packageDirectory);
  const contract = await readJsonFile(join(directory, 'acceptance-contract.json'));
  const results = await readJsonFile(join(directory, 'results.json'));
  const errors = [
    ...formatValidationErrors('contract', validateAcceptanceContract(contract)),
    ...formatValidationErrors('results', validateAcceptanceResults(results)),
  ];
  if (errors.length > 0) throw new Error(`Cannot generate report from invalid acceptance data:\n${errors.join('\n')}`);
  const output = join(directory, 'acceptance-report.md');
  const temporary = join(directory, `.acceptance-report.${process.pid}.tmp`);
  await writeFile(temporary, renderAcceptanceReport(contract, results), { encoding: 'utf8', flag: 'w' });
  await rename(temporary, output);
  return output;
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const packageDirectory = process.argv[2];
  if (!packageDirectory) {
    process.stderr.write('Usage: node scripts/acceptance/generate-report.mjs <acceptance-package-directory>\n');
    process.exitCode = 2;
  } else {
    try {
      const output = await generateAcceptanceReport(packageDirectory);
      process.stdout.write(`Generated ${output}\n`);
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  }
}
