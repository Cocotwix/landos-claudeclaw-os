#!/usr/bin/env node
// Duke Visual Evidence Capture v1.
//
// Captures ONE screenshot of an allowlisted public page via local Chrome
// headless and saves it OUTSIDE the Git-tracked repo, so Duke can Read the
// PNG and classify it as a visual signal only. Visuals never verify parcel
// identity -- capture is for parcels already verified through allowed
// sources, and only when Tyler asks for visual capture.
//
// Safety properties:
//   - Allowlist: https-only, .gov / .us public-record hosts (county GIS,
//     FEMA, USGS). Explicit deny list for Google/Zillow/Redfin/Realtor/
//     Trulia/social/Bing regardless of any other rule.
//   - No login flows, no CAPTCHA workarounds: if the page blocks
//     automation the capture simply fails and Duke reports
//     "Visual Signal: unavailable".
//   - Output directory must be outside the repo (default:
//     %USERPROFILE%\duke-visual-evidence). Property work product never
//     lands in Git.
//   - Bounded timeout; Chrome is killed if it overruns.
//   - No .env reads, no secrets, no paid APIs, no network beyond the one
//     allowlisted page Chrome loads.
//
// Usage:
//   node capture-visual.js <https-url> <label> [--out <dir>] [--timeout <ms>]
//
// Check-only flags (used by tests; no Chrome, no network):
//   node capture-visual.js --validate-only <url>
//   node capture-visual.js --resolve-dir [dir]
//   node capture-visual.js --filename-for <label>

import { existsSync, mkdirSync, statSync } from 'fs';
import { homedir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
// scripts/ -> duke-due-diligence/ -> landos-agents/ -> repo root
export const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..', '..');

export const DEFAULT_EVIDENCE_DIR = path.join(homedir(), 'duke-visual-evidence');
export const DEFAULT_TIMEOUT_MS = 45_000;

// Official public-record hosts only. County GIS viewers, assessors, FEMA,
// USGS, and state portals live under these suffixes.
export const ALLOWED_HOST_SUFFIXES = ['.gov', '.us'];

// Deny-first, regardless of any other rule. None of these would pass the
// allowlist anyway -- this is defense-in-depth against future loosening.
export const BLOCKED_HOST_SUFFIXES = [
  'google.com',
  'googleapis.com',
  'gstatic.com',
  'zillow.com',
  'redfin.com',
  'realtor.com',
  'trulia.com',
  'facebook.com',
  'instagram.com',
  'bing.com',
];

function hostMatches(hostname, suffix) {
  return hostname === suffix || hostname.endsWith('.' + suffix.replace(/^\./, ''));
}

export function validateCaptureUrl(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl));
  } catch {
    return { ok: false, reason: 'not a valid URL', url: null };
  }
  if (url.protocol !== 'https:') {
    return { ok: false, reason: 'only https URLs are allowed', url: null };
  }
  if (url.username || url.password) {
    return { ok: false, reason: 'URLs with embedded credentials are not allowed', url: null };
  }
  const hostname = url.hostname.toLowerCase();
  for (const blocked of BLOCKED_HOST_SUFFIXES) {
    if (hostMatches(hostname, blocked)) {
      return { ok: false, reason: `host ${hostname} is on the deny list (no Google/Zillow/listing-site automation)`, url: null };
    }
  }
  const allowed = ALLOWED_HOST_SUFFIXES.some((s) => hostname.endsWith(s));
  if (!allowed) {
    return { ok: false, reason: `host ${hostname} is not on the public-records allowlist (${ALLOWED_HOST_SUFFIXES.join(', ')})`, url: null };
  }
  return { ok: true, reason: null, url };
}

export function safeEvidenceFilename(label) {
  const slug = String(label ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'visual';
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${slug}-${ts}.png`;
}

export function resolveEvidenceDir(dir) {
  const resolved = path.resolve(dir ?? DEFAULT_EVIDENCE_DIR);
  if (resolved === REPO_ROOT || resolved.startsWith(REPO_ROOT + path.sep)) {
    return { ok: false, reason: 'evidence directory must be outside the Git-tracked repo', dir: null };
  }
  return { ok: true, reason: null, dir: resolved };
}

function findChrome() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

export function captureVisualEvidence({ url, label, outDir, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  return new Promise((resolve) => {
    const checked = validateCaptureUrl(url);
    if (!checked.ok) return resolve({ ok: false, reason: checked.reason });

    const dirResult = resolveEvidenceDir(outDir);
    if (!dirResult.ok) return resolve({ ok: false, reason: dirResult.reason });

    const chrome = findChrome();
    if (!chrome) return resolve({ ok: false, reason: 'local Chrome not found at the standard install paths' });

    mkdirSync(dirResult.dir, { recursive: true });
    const outPath = path.join(dirResult.dir, safeEvidenceFilename(label));

    const child = spawn(
      chrome,
      [
        '--headless',
        '--disable-gpu',
        '--no-sandbox',
        '--hide-scrollbars',
        '--window-size=1600,1000',
        '--virtual-time-budget=12000',
        `--screenshot=${outPath}`,
        checked.url.href,
      ],
      { stdio: 'ignore' },
    );

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, reason: `Chrome failed to start: ${err.message}` });
    });

    child.on('exit', () => {
      clearTimeout(timer);
      if (timedOut) {
        return resolve({ ok: false, reason: `capture timed out after ${timeoutMs}ms -- visual unavailable` });
      }
      if (existsSync(outPath) && statSync(outPath).size > 0) {
        return resolve({ ok: true, path: outPath });
      }
      resolve({ ok: false, reason: 'Chrome exited without producing a screenshot (page may block automation) -- visual unavailable' });
    });
  });
}

async function main() {
  const args = process.argv.slice(2);

  // Check-only modes (no Chrome, no network) -- used by tests.
  if (args[0] === '--validate-only') {
    const result = validateCaptureUrl(args[1]);
    console.log(result.ok ? 'ALLOWED' : `BLOCKED: ${result.reason}`);
    process.exit(result.ok ? 0 : 1);
  }
  if (args[0] === '--resolve-dir') {
    const result = resolveEvidenceDir(args[1]);
    console.log(result.ok ? result.dir : `REFUSED: ${result.reason}`);
    process.exit(result.ok ? 0 : 1);
  }
  if (args[0] === '--filename-for') {
    console.log(safeEvidenceFilename(args[1]));
    process.exit(0);
  }

  const positional = args.filter((a) => !a.startsWith('--'));
  const url = positional[0];
  const label = positional[1];
  const outIdx = args.indexOf('--out');
  const timeoutIdx = args.indexOf('--timeout');
  const outDir = outIdx !== -1 ? args[outIdx + 1] : undefined;
  const timeoutMs = timeoutIdx !== -1 ? Number(args[timeoutIdx + 1]) || DEFAULT_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;

  if (!url || !label) {
    console.error('Usage: node capture-visual.js <https-url> <label> [--out <dir>] [--timeout <ms>]');
    process.exit(1);
  }

  const result = await captureVisualEvidence({ url, label, outDir, timeoutMs });
  if (result.ok) {
    console.log(`Visual evidence saved: ${result.path}`);
  } else {
    console.log(`Visual capture failed: ${result.reason}`);
    process.exit(1);
  }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main();
}
