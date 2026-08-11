#!/usr/bin/env node
// Exact failure diagnostics for the LandOS mission harness.
//
// A repair worker must never again be handed only "no-unrelated-regression
// failed". Every fact this module can extract from a failed check — the test
// file, the test title, the assertion, expected versus received, the source
// line — is extracted once here, by the process that already ran the command,
// and travels with the repair brief. Rediscovering a failure the harness
// already saw is the single most expensive waste in the old loop.
//
// The parsers are deliberately tolerant: reporters change wording between
// versions, so every extractor returns what it found and never throws. A
// failure the parsers do not recognise still carries its raw tail, which is
// strictly more than the old truncated blob.

const ANSI = /\[[0-9;]*m/g;

export function stripAnsi(text) {
  return String(text ?? '').replace(ANSI, '');
}

/** Last N non-empty lines, for when structured extraction finds nothing. */
export function tail(text, lines = 40) {
  return stripAnsi(text)
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .slice(-lines)
    .join('\n');
}

// Vitest prints one ` FAIL  <file> > <suite> > <test>` line per failing test,
// then the error. Both halves matter: the file and title route the repair, the
// assertion explains it.
export function parseVitest(text) {
  const clean = stripAnsi(text);
  const lines = clean.split(/\r?\n/);
  const failures = [];

  for (let index = 0; index < lines.length; index += 1) {
    const header = /^\s*(?:FAIL|×|✗)\s+(\S+?\.(?:test|spec)\.[cm]?[jt]sx?)\s*(?:>|›)\s*(.+)$/.exec(lines[index]);
    if (!header) continue;
    const file = header[1].replace(/\\/g, '/');
    const title = header[2].trim();
    if (failures.some((entry) => entry.file === file && entry.title === title)) continue;

    // The assertion and its expected/received block follow the header, before
    // the next FAIL header. Bound the window so one failure never swallows the
    // rest of the report.
    const window = lines.slice(index + 1, index + 40);
    const stop = window.findIndex((line) => /^\s*(?:FAIL|×|✗)\s+\S+\.(?:test|spec)\./.test(line));
    const body = (stop === -1 ? window : window.slice(0, stop)).join('\n');

    failures.push({
      file,
      title,
      assertion: firstMatch(body, /^\s*((?:AssertionError|TypeError|ReferenceError|RangeError|SyntaxError|Error)[^\n]*)/m),
      expected: firstMatch(body, /^\s*-\s*Expected\s*\n\s*\+\s*Received\s*\n+\s*-\s*(.+)$/m) ?? firstMatch(body, /expected\s+(.+?)\s+to\s+/i),
      received: firstMatch(body, /^\s*-\s*Expected\s*\n\s*\+\s*Received\s*\n+\s*-\s*.+\n\s*\+\s*(.+)$/m),
      at: firstMatch(body, /❯\s+(\S+:\d+:\d+)/) ?? firstMatch(body, /\s+at\s+.*\((\S+:\d+:\d+)\)/),
    });
  }

  const counts = /Tests\s+(?:(\d+)\s+failed)?[^\n]*?(\d+)\s+passed/.exec(clean);
  return {
    tool: 'vitest',
    failures,
    failedCount: counts?.[1] ? Number(counts[1]) : failures.length,
    passedCount: counts?.[2] ? Number(counts[2]) : null,
    failedFiles: [...new Set(failures.map((entry) => entry.file))],
  };
}

// tsc --noEmit: `path(line,col): error TS2345: message`
export function parseTypescript(text) {
  const clean = stripAnsi(text);
  const failures = [];
  const pattern = /^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)$/gm;
  let match = pattern.exec(clean);
  while (match) {
    failures.push({
      file: match[1].replace(/\\/g, '/'),
      title: `${match[4]} at line ${match[2]}`,
      assertion: match[5].trim(),
      at: `${match[1].replace(/\\/g, '/')}:${match[2]}:${match[3]}`,
    });
    match = pattern.exec(clean);
  }
  return {
    tool: 'typescript',
    failures,
    failedCount: failures.length,
    passedCount: null,
    failedFiles: [...new Set(failures.map((entry) => entry.file))],
  };
}

function firstMatch(text, pattern) {
  const match = pattern.exec(String(text ?? ''));
  return match ? match[1].trim() : null;
}

function looksLikeVitest(text) {
  return /\bvitest\b|Test Files\s+\d|\bFAIL\b\s+\S+\.(test|spec)\./.test(text);
}

function looksLikeTypescript(text) {
  return /\)\:\s+error\s+TS\d+:/.test(text);
}

/**
 * Turn a failed check into a precise, self-contained repair brief.
 * `check` is an evaluator check result; `output` is whatever the command wrote.
 */
export function diagnoseFailure(check, output = '', { baselineFailures = [] } = {}) {
  const raw = `${output ?? ''}\n${check?.detail ?? ''}`;
  // Detection has to run on stripped text. Real reporter output puts colour
  // codes between "FAIL" and the filename, and between "Test Files" and its
  // count, so every detector below fails against raw output and the whole
  // diagnosis silently degrades to "unrecognised" on exactly the coloured
  // output every real run produces.
  const text = stripAnsi(raw);
  const parsed = looksLikeTypescript(text) ? parseTypescript(text) : looksLikeVitest(text) ? parseVitest(text) : null;

  const baseline = new Set(baselineFailures.map((entry) => `${entry.file}::${entry.title}`));
  const failures = (parsed?.failures ?? []).map((failure) => ({
    ...failure,
    // A failure that was already red before this mission is not this mission's
    // defect. Saying so stops a repair worker from "fixing" a pre-existing one.
    preExisting: baseline.has(`${failure.file}::${failure.title}`),
  }));

  return {
    checkId: check?.id ?? 'unknown',
    checkKind: check?.kind ?? 'unknown',
    requirement: check?.requirement ?? null,
    command: check?.command ?? null,
    exitCode: check?.exitCode ?? null,
    tool: parsed?.tool ?? 'unrecognised',
    failedCount: parsed?.failedCount ?? null,
    passedCount: parsed?.passedCount ?? null,
    failures,
    newFailures: failures.filter((failure) => !failure.preExisting),
    candidateFiles: [...new Set(failures.map((failure) => failure.file))],
    // Kept whatever the parsers managed: a recognised failure still benefits
    // from surrounding context, an unrecognised one has nothing else.
    rawTail: tail(text, failures.length ? 20 : 60),
  };
}

/** One human line per failure, for telemetry and the repair prompt. */
export function formatDiagnosis(diagnosis) {
  if (!diagnosis?.failures?.length) {
    return `${diagnosis?.checkId ?? 'check'} failed (exit ${diagnosis?.exitCode ?? '?'}) — no structured failure parsed:\n${diagnosis?.rawTail ?? ''}`;
  }
  const lines = diagnosis.failures.map((failure) => {
    const where = failure.at ? ` (${failure.at})` : '';
    const flag = failure.preExisting ? ' [pre-existing on baseline]' : '';
    const detail = failure.assertion ? ` — ${failure.assertion}` : '';
    const compare =
      failure.expected && failure.received ? ` | expected ${failure.expected}, received ${failure.received}` : '';
    return `${failure.file} > ${failure.title}${where}${detail}${compare}${flag}`;
  });
  return lines.join('\n');
}
