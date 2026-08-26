#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';

const CONTINUE_MESSAGE = `The active LandOS sprint is NOT finished. You are not allowed to stop here. Continue executing the ORIGINAL user request immediately. Do not return a status report, remaining-work summary, recommendation, or next-step proposal. Fix whatever remains incomplete and continue until every acceptance criterion from the original request is actually satisfied. Only terminate with LANDOS_SPRINT_COMPLETE: PASS after verification, or LANDOS_SPRINT_BLOCKED: after exhausting available tools against a genuine external blocker.`;

const IMPLEMENTATION_WORDS = /\b(implement(?:ation)?|build|fix|feature|sprint|install|verify|acceptance|localhost|refresh persistence|test|typecheck|run|create|wire|load)\b/i;
const LANDOS_WORD = /\bLandOS\b/i;
const COMPLETE_MARKER = /LANDOS_SPRINT_COMPLETE:\s*PASS\b/;
const BLOCKED_MARKER = /LANDOS_SPRINT_BLOCKED:/;
const EXTERNAL_WORD = /\b(external|outside (?:our|my|the agent'?s|available) control|requires (?:Tyler|operator|human)|approval gate|credential|secret|MFA|CAPTCHA|network outage|provider outage|unavailable service)\b/i;
const EXHAUSTED_WORD = /\b(exhausted|tried|attempted|retried|no available tool|all available tools|reasonable attempts|cannot resolve with available tools)\b/i;

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === 'string') return part;
      if (part && typeof part === 'object') {
        if (typeof part.text === 'string') return part.text;
        if (typeof part.content === 'string') return part.content;
      }
      return '';
    }).join('\n');
  }
  if (content && typeof content === 'object') {
    if (typeof content.text === 'string') return content.text;
    if (typeof content.content === 'string') return content.content;
  }
  return '';
}

function messageRole(record) {
  const msg = record?.message && typeof record.message === 'object' ? record.message : record;
  return msg?.role ?? record?.role ?? null;
}

function messageText(record) {
  const msg = record?.message && typeof record.message === 'object' ? record.message : record;
  return normalizeContent(msg?.content ?? record?.content ?? '');
}

function readTranscript(path) {
  if (!path || typeof path !== 'string') return [];
  const candidates = [path];
  if (/^\/[a-zA-Z]\//.test(path)) candidates.push(`${path[1]}:/${path.slice(3)}`);
  if (path.startsWith('/tmp/')) candidates.push(`C:/tmp/${path.slice(5)}`);
  let raw;
  for (const candidate of candidates) {
    try {
      if (!existsSync(candidate)) continue;
      raw = readFileSync(candidate, 'utf8');
      break;
    } catch {
      // Try the next path shape. Hook runtimes may hand MSYS or native paths.
    }
  }
  if (!raw) return [];
  return raw.split(/\r?\n/).filter(Boolean).map(parseJson).filter(Boolean);
}

function latestAssistantText(records, input) {
  if (typeof input?.response === 'string' && input.response.trim()) return input.response;
  for (let i = records.length - 1; i >= 0; i -= 1) {
    if (messageRole(records[i]) === 'assistant') return messageText(records[i]);
  }
  return '';
}

function latestUserText(records, input) {
  if (typeof input?.prompt === 'string' && input.prompt.trim()) return input.prompt;
  for (let i = records.length - 1; i >= 0; i -= 1) {
    if (messageRole(records[i]) === 'user') return messageText(records[i]);
  }
  return '';
}

export function isActiveLandosSprint({ transcriptRecords = [], input = {} } = {}) {
  const userText = latestUserText(transcriptRecords, input);
  const allUserText = transcriptRecords
    .filter((record) => messageRole(record) === 'user')
    .map(messageText)
    .join('\n');
  const cwd = typeof input.cwd === 'string' ? input.cwd : '';
  const projectScoped = /claudeclaw-os/i.test(cwd) || /LandOS/i.test(allUserText) || LANDOS_WORD.test(userText);
  return projectScoped && LANDOS_WORD.test(`${userText}\n${allUserText}`) && IMPLEMENTATION_WORDS.test(userText);
}

export function evaluateLandosSprintStop({ transcriptRecords = [], input = {} } = {}) {
  if (!isActiveLandosSprint({ transcriptRecords, input })) {
    return { allow: true, reason: 'No active LandOS implementation sprint detected.' };
  }

  const assistantText = latestAssistantText(transcriptRecords, input);
  if (COMPLETE_MARKER.test(assistantText)) {
    return { allow: true, reason: 'Completion marker present.' };
  }

  if (BLOCKED_MARKER.test(assistantText)) {
    const blockedSection = assistantText.slice(assistantText.search(BLOCKED_MARKER));
    if (EXTERNAL_WORD.test(blockedSection) && EXHAUSTED_WORD.test(blockedSection)) {
      return { allow: true, reason: 'External exhausted blocker marker present.' };
    }
    return {
      allow: false,
      reason: `${CONTINUE_MESSAGE}\n\nLANDOS_SPRINT_BLOCKED is only terminal when it identifies a genuine external blocker and states that available tools/reasonable attempts were exhausted.`,
    };
  }

  return { allow: false, reason: CONTINUE_MESSAGE };
}

function emitBlock(reason) {
  // Claude Code Stop hooks treat a JSON block decision as the structured path.
  // Exit code 2 is retained as the enforcement fallback for hook runtimes that
  // use stderr as the blocking reason.
  const payload = { decision: 'block', reason };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  process.stderr.write(`${reason}\n`);
  process.exit(2);
}

function main() {
  const input = parseJson(readStdin()) ?? {};
  const transcriptRecords = readTranscript(input.transcript_path);
  const verdict = evaluateLandosSprintStop({ transcriptRecords, input });
  if (verdict.allow) {
    process.stdout.write(`${JSON.stringify({ decision: 'approve', reason: verdict.reason })}\n`);
    return;
  }
  emitBlock(verdict.reason);
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('session-stop-guard.mjs')) {
  main();
}
