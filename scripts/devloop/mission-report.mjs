#!/usr/bin/env node
// Render a completed devloop mission as a readable Markdown report.
//
// The exported renderer is pure; only the direct CLI entry point reads mission
// state from disk.
//
//   node scripts/devloop/mission-report.mjs <missionId>

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadMission } from './mission.mjs';

const REPOSITORY_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function text(value, fallback = 'Not provided.') {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value);
}

function markdownCell(value) {
  return text(value, '—').replaceAll('|', '\\|').replaceAll('\n', '<br>');
}

function humanDuration(durationMs, startedAt, finishedAt) {
  let milliseconds = durationMs === undefined || durationMs === null ? Number.NaN : Number(durationMs);
  if (!Number.isFinite(milliseconds) && startedAt && finishedAt) {
    milliseconds = Date.parse(finishedAt) - Date.parse(startedAt);
  }
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '—';
  if (milliseconds < 1000) return `${Math.round(milliseconds)}ms`;

  let seconds = Math.round(milliseconds / 1000);
  const days = Math.floor(seconds / 86400);
  seconds %= 86400;
  const hours = Math.floor(seconds / 3600);
  seconds %= 3600;
  const minutes = Math.floor(seconds / 60);
  seconds %= 60;

  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (seconds || parts.length === 0) parts.push(`${seconds}s`);
  return parts.join(' ');
}

function explicitPass(value) {
  if (typeof value === 'boolean') return value;
  if (!value || typeof value !== 'object') return undefined;
  for (const key of ['passed', 'pass', 'ok', 'success']) {
    if (typeof value[key] === 'boolean') return value[key];
  }
  if (typeof value.exitCode === 'number') return value.exitCode === 0;
  if (typeof value.status === 'string') {
    const status = value.status.toLowerCase();
    if (['pass', 'passed', 'success', 'successful', 'complete', 'completed'].includes(status)) return true;
    if (['fail', 'failed', 'failure', 'error', 'blocked'].includes(status)) return false;
  }
  return undefined;
}

function resultItems(result) {
  if (Array.isArray(result)) return result;
  if (!result || typeof result !== 'object') return [];
  for (const key of ['checks', 'results', 'items']) {
    if (Array.isArray(result[key])) return result[key];
  }
  return [];
}

function checkId(check, index) {
  if (typeof check === 'string') return check;
  return check?.id ?? check?.checkId ?? check?.name ?? `check-${index + 1}`;
}

function renderChecks(configured, result) {
  const definitions = Array.isArray(configured) ? configured : [];
  const results = resultItems(result);
  const aggregate = explicitPass(result);
  const byId = new Map(results.map((item, index) => [String(checkId(item, index)), item]));
  const checks = [];

  definitions.forEach((definition, index) => {
    const id = String(checkId(definition, index));
    const item = byId.get(id);
    const passed = explicitPass(item) ?? explicitPass(definition) ?? aggregate ?? false;
    checks.push({ id, passed });
    byId.delete(id);
  });
  for (const [id, item] of byId) checks.push({ id, passed: explicitPass(item) ?? false });

  if (checks.length === 0 && results.length > 0) {
    results.forEach((item, index) => {
      checks.push({ id: String(checkId(item, index)), passed: explicitPass(item) ?? false });
    });
  }
  if (checks.length === 0) return '- None.';
  return checks.map(({ id, passed }) => `- \`${id.replaceAll('`', '\\`')}\`: ${passed ? 'PASS' : 'FAIL'}`).join('\n');
}

function integratedFiles(mission) {
  const integration = mission?.integration;
  const candidates = [
    mission?.integratedFiles,
    integration?.changedPaths,
    integration?.integratedPaths,
    integration?.files,
    integration?.paths,
  ];
  const files = candidates.find(Array.isArray) ?? [];
  return [...new Set(files.map(String))];
}

function failureEvidence(mission) {
  if (String(mission?.terminalState).toUpperCase() === 'FAIL') return true;
  if (String(mission?.status).toLowerCase() === 'failed') return true;
  if ((mission?.lanes ?? []).some((lane) => ['failed', 'blocked'].includes(String(lane?.status).toLowerCase()))) return true;
  for (const result of [mission?.focusedResult, mission?.validationResult]) {
    if (explicitPass(result) === false) return true;
    if (resultItems(result).some((item) => explicitPass(item) === false)) return true;
  }
  return false;
}

function headlineState(mission) {
  if (failureEvidence(mission)) return 'FAIL';
  const state = String(mission?.terminalState ?? '').toUpperCase();
  return ['PASS', 'FAIL', 'NEEDS_ATTENTION'].includes(state) ? state : 'NEEDS_ATTENTION';
}

/**
 * Render a mission object without performing I/O or mutating the object.
 *
 * @param {object} mission
 * @returns {string}
 */
export function renderMissionMarkdown(mission) {
  const value = mission && typeof mission === 'object' ? mission : {};
  const lanes = Array.isArray(value.lanes) ? value.lanes : [];
  const files = integratedFiles(value);
  const waves = Array.isArray(value.waves)
    ? value.waves
    : Array.isArray(value.execution?.waves) ? value.execution.waves : null;
  const derivedPeakConcurrency = waves?.reduce((peak, wave) => Math.max(peak, Array.isArray(wave) ? wave.length : 0), 0);
  const peakConcurrency = value.peakConcurrency ?? value.metrics?.peakConcurrency ?? value.execution?.peakConcurrency ?? derivedPeakConcurrency ?? '—';
  // The harness records `mission.waves` as a COUNT, not a list of waves, so a
  // numeric value is the ordinary case and has to be read before the shapes
  // this renderer merely tolerates.
  const waveCount =
    (typeof value.waves === 'number' ? value.waves : null) ??
    value.waveCount ??
    value.metrics?.waveCount ??
    value.execution?.waveCount ??
    waves?.length ??
    '—';
  const lines = [
    `# ${headlineState(value)} — ${text(value.missionId, 'unknown mission')}`,
    '',
    '## Request',
    '',
    text(value.request),
    '',
    '## Operator outcome',
    '',
    text(value.operatorOutcome),
    '',
    '## Execution',
    '',
    `- peak concurrency: ${peakConcurrency}`,
    `- wave count: ${waveCount}`,
    '',
    '## Lanes',
    '',
    '| Lane | Kind | Builder | Status | Duration | Files changed |',
    '| --- | --- | --- | --- | ---: | ---: |',
  ];

  if (lanes.length === 0) {
    lines.push('| — | — | — | — | — | 0 |');
  } else {
    for (const lane of lanes) {
      const changedCount = Array.isArray(lane?.changedPaths)
        ? lane.changedPaths.length
        : Number.isFinite(Number(lane?.changedFiles)) ? Number(lane.changedFiles) : 0;
      lines.push(`| ${markdownCell(lane?.id)} | ${markdownCell(lane?.kind)} | ${markdownCell(lane?.builderId)} | ${markdownCell(lane?.status)} | ${humanDuration(lane?.durationMs, lane?.startedAt, lane?.finishedAt)} | ${changedCount} |`);
    }
  }

  lines.push(
    '',
    '## Integrated files',
    '',
    files.length ? files.map((file) => `- \`${file.replaceAll('`', '\\`')}\``).join('\n') : '- None.',
    '',
    '## Focused checks',
    '',
    renderChecks(value.focusedChecks, value.focusedResult),
    '',
    '## Validation checks',
    '',
    renderChecks(value.validationChecks, value.validationResult),
    '',
    '## Terminal reason',
    '',
    text(value.terminalReason ?? value.reason ?? value.error),
    '',
  );

  return lines.join('\n');
}

function main() {
  const missionId = process.argv[2];
  if (!missionId) {
    console.error('Usage: node scripts/devloop/mission-report.mjs <missionId>');
    process.exitCode = 2;
    return;
  }

  try {
    console.log(renderMissionMarkdown(loadMission(REPOSITORY_ROOT, missionId)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
