#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const ENTRY = path.join(ROOT, 'dist', 'index.js');
const RUNTIME_DIR = path.join(ROOT, '.runtime', 'landos');
const METADATA_FILE = path.join(RUNTIME_DIR, 'runtime.json');
const HISTORY_FILE = path.join(RUNTIME_DIR, 'history.json');
const OPERATION_LOCK = path.join(RUNTIME_DIR, 'operation.lock');
const STORE_PID_FILE = path.join(ROOT, 'store', 'claudeclaw.pid');
const STDOUT_LOG = path.join(RUNTIME_DIR, 'stdout.log');
const STDERR_LOG = path.join(RUNTIME_DIR, 'stderr.log');
const MAIN_LOG = path.join(ROOT, 'logs', 'main.log');
const INSPECTOR = path.join(SCRIPT_DIR, 'inspect-process.ps1');
const DETACHED_LAUNCHER = path.join(SCRIPT_DIR, 'launch-detached.ps1');
const ENV_MODULE = path.join(ROOT, 'dist', 'env.js');
const PORT = 3141;
const URL = `http://localhost:${PORT}`;
const HEALTH_PATH = '/api/health';
const START_TIMEOUT_MS = 45_000;
const STOP_TIMEOUT_MS = 8_000;
const HTTP_TIMEOUT_MS = 3_000;
// Windows process inspection can exceed five seconds when the machine is under
// browser/research load. Treating that transient slowness as an unknown PID
// strands canonical restart/start operations even after the server has exited.
const COMMAND_TIMEOUT_MS = 15_000;
const OPERATION_STALE_MS = 120_000;
const MAIN_LOG_MAX_BYTES = 10 * 1024 * 1024;
const MAIN_LOG_KEEP_BYTES = 5 * 1024 * 1024;

function windowsPath(name) {
  const systemRoot = process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\Windows';
  if (name === 'powershell') return path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return path.join(systemRoot, 'System32', `${name}.exe`);
}

function samePath(left, right) {
  if (!left || !right) return false;
  const normalize = (value) => path.resolve(value).replace(/[\\/]+$/, '').toLowerCase();
  return normalize(left) === normalize(right);
}

function quote(value) {
  const text = String(value);
  return /[\s"]/u.test(text) ? `"${text.replace(/"/gu, '\\"')}"` : text;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, file);
}

function removeIfOwned(file, predicate) {
  try {
    const value = readJson(file);
    if (predicate(value)) fs.unlinkSync(file);
  } catch { /* already absent or no longer ours */ }
}

function processInfo(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return { alive: false, pid, reason: 'invalid PID' };
  const result = spawnSync(windowsPath('powershell'), [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', INSPECTOR, '-PidNumber', String(pid),
  ], { cwd: ROOT, encoding: 'utf8', timeout: COMMAND_TIMEOUT_MS, windowsHide: true });
  if (result.error) return { alive: false, pid, reason: result.error.message, inspectionFailed: true };
  try { return JSON.parse((result.stdout || '').trim()); } catch {
    return { alive: false, pid, reason: (result.stderr || 'process inspection returned no data').trim(), inspectionFailed: true };
  }
}

function processStartMatches(actual, expected, toleranceMs = 5_000) {
  const a = Date.parse(actual || '');
  const e = Date.parse(expected || '');
  return Number.isFinite(a) && Number.isFinite(e) && Math.abs(a - e) <= toleranceMs;
}

function readStorePid() {
  try {
    const value = Number.parseInt(fs.readFileSync(STORE_PID_FILE, 'utf8').trim(), 10);
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch { return null; }
}

function portOwners() {
  const result = spawnSync(windowsPath('netstat'), ['-ano', '-p', 'TCP'], {
    cwd: ROOT, encoding: 'utf8', timeout: COMMAND_TIMEOUT_MS, windowsHide: true,
  });
  if (result.error) return { owners: [], error: result.error.message };
  const owners = new Set();
  for (const line of (result.stdout || '').split(/\r?\n/u)) {
    const match = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/iu);
    if (match && Number(match[1]) === PORT) owners.add(Number(match[2]));
  }
  return { owners: [...owners], error: result.status === 0 ? null : (result.stderr || `netstat exited ${result.status}`).trim() };
}

async function readDashboardToken() {
  const inherited = process.env.DASHBOARD_TOKEN?.trim();
  if (inherited) return inherited;
  try {
    const previousCwd = process.cwd();
    process.chdir(ROOT);
    try {
      const { readEnvFile } = await import(pathToFileURL(ENV_MODULE).href);
      return readEnvFile(['DASHBOARD_TOKEN']).DASHBOARD_TOKEN || '';
    } finally { process.chdir(previousCwd); }
  } catch { return ''; }
}

function authenticatedHealthUrl(token) {
  const url = new globalThis.URL(HEALTH_PATH, `${URL}/`);
  if (token) url.searchParams.set('token', token);
  return url.toString();
}

async function httpProbe(url, json = false, options = {}) {
  const { timeoutMs = HTTP_TIMEOUT_MS, fetchImpl = fetch } = options;
  const started = Date.now();
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' });
    let body = null;
    if (json) {
      try { body = await response.json(); } catch (error) { return { ok: false, status: response.status, reason: `invalid JSON: ${error.message}`, elapsedMs: Date.now() - started }; }
    }
    return { ok: response.status === 200, status: response.status, body, reason: response.status === 200 ? null : `HTTP ${response.status}`, elapsedMs: Date.now() - started };
  } catch (error) {
    return { ok: false, status: null, reason: error?.cause?.message || error.message, elapsedMs: Date.now() - started };
  }
}

function findStartupEvidence(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || !fs.existsSync(MAIN_LOG)) return null;
  const fd = fs.openSync(MAIN_LOG, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const chunkSize = 1024 * 1024;
    const maxRead = Math.min(size, 64 * 1024 * 1024);
    let offset = size;
    let carried = '';
    while (offset > size - maxRead) {
      const length = Math.min(chunkSize, offset - Math.max(0, size - maxRead));
      offset -= length;
      const buffer = Buffer.allocUnsafe(length);
      fs.readSync(fd, buffer, 0, length, offset);
      const text = buffer.toString('utf8') + carried;
      const lines = text.split(/\r?\n/u);
      carried = lines.shift() || '';
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index];
        if (!line.includes('"event":"server_startup"') || !line.includes(`"pid":${pid}`)) continue;
        try {
          const event = JSON.parse(line);
          if (event.pid === pid && event.event === 'server_startup' && samePath(event.cwd, ROOT) && Number(event.port) === PORT) return event;
        } catch { /* continue searching */ }
      }
    }
    return null;
  } finally { fs.closeSync(fd); }
}

function readHistory() {
  const value = readJson(HISTORY_FILE);
  return Array.isArray(value) ? value.filter((item) => item && Number.isInteger(item.pid)) : [];
}

function nextHistory(existing, metadata, limit = 20) {
  const retained = existing.filter((item) => item?.runtimeId !== metadata.runtimeId);
  retained.push({
    schema: 1,
    pid: metadata.pid,
    processStartTime: metadata.processStartTime,
    runtimeId: metadata.runtimeId,
    repoRoot: metadata.repoRoot,
    entryPoint: metadata.entryPoint,
    executable: metadata.executable,
    command: metadata.command,
    startedAt: metadata.startedAt,
  });
  return retained.slice(-limit);
}

function recordHistory(metadata) {
  writeJsonAtomic(HISTORY_FILE, nextHistory(readHistory(), metadata));
}

function metadataAssociation(metadata, info) {
  return Boolean(metadata
    && metadata.schema === 1
    && metadata.pid === info.pid
    && info.alive
    && samePath(metadata.repoRoot, ROOT)
    && samePath(metadata.entryPoint, ENTRY)
    && samePath(metadata.executable, process.execPath)
    && processStartMatches(info.startTime, metadata.processStartTime));
}

function historyAssociation(item, info) {
  return Boolean(item
    && item.schema === 1
    && item.pid === info.pid
    && info.alive
    && samePath(item.repoRoot, ROOT)
    && samePath(item.entryPoint, ENTRY)
    && samePath(item.executable, process.execPath)
    && processStartMatches(info.startTime, item.processStartTime));
}

function metadataDisposition(metadata, info) {
  if (!metadata) return 'none';
  if (info?.inspectionFailed) return 'unknown';
  return metadataAssociation(metadata, info || {}) ? 'current' : 'stale';
}

function healthAssociation(runtime, candidate) {
  if (!runtime || !candidate?.info?.alive) return false;
  const metadata = candidate.metadata;
  return runtime.pid === candidate.pid
    && samePath(runtime.cwd, ROOT)
    && samePath(runtime.repoRoot, ROOT)
    && samePath(runtime.entryPoint, ENTRY)
    && samePath(runtime.executable, process.execPath)
    && (!metadata || runtime.runtimeId === metadata.runtimeId)
    && processStartMatches(runtime.processStartTime, candidate.info.startTime, 10_000);
}

function legacyAssociation(pid, info, storePid) {
  if (!info.alive || pid !== storePid || !samePath(info.executable, process.execPath)) return { verified: false, evidence: null };
  const evidence = findStartupEvidence(pid);
  return {
    verified: Boolean(evidence && Math.abs(Number(evidence.time) - Date.parse(info.startTime)) <= 30_000),
    evidence,
  };
}

async function gatherState() {
  const metadata = readJson(METADATA_FILE);
  const history = readHistory();
  const storePid = readStorePid();
  const port = portOwners();
  const ids = new Set([
    metadata?.pid,
    storePid,
    ...history.map((item) => item.pid),
    ...port.owners,
  ].filter((pid) => Number.isInteger(pid) && pid > 0));
  const dashboardToken = await readDashboardToken();
  const [rootProbe, healthProbe] = await Promise.all([httpProbe(URL), httpProbe(authenticatedHealthUrl(dashboardToken), true)]);
  const candidates = [];
  const inspectionErrors = [];
  const infoByPid = new Map();

  for (const pid of ids) {
    const info = processInfo(pid);
    infoByPid.set(pid, info);
    if (info.inspectionFailed) inspectionErrors.push(`PID ${pid}: ${info.reason}`);
    if (!info.alive) continue;
    const candidateMetadata = metadata?.pid === pid ? metadata : null;
    const metadataVerified = metadataAssociation(candidateMetadata, info);
    const historyMatch = history.find((item) => historyAssociation(item, info));
    const historyVerified = Boolean(historyMatch);
    const legacy = legacyAssociation(pid, info, storePid);
    const candidate = {
      pid,
      info,
      metadata: candidateMetadata,
      metadataVerified,
      historyVerified,
      legacyVerified: legacy.verified,
      startupEvidence: legacy.evidence,
      healthVerified: false,
      verified: metadataVerified || historyVerified || legacy.verified,
      ownsPort: port.owners.includes(pid),
      command: candidateMetadata?.command || historyMatch?.command || null,
      association: metadataVerified ? 'runtime metadata + process start time'
        : historyVerified ? 'runtime history + process start time'
          : legacy.verified ? 'server PID file + startup log cwd + process start time'
            : 'unverified',
    };
    if (candidate.ownsPort && healthProbe.ok && healthAssociation(healthProbe.body?.runtime, candidate)) {
      candidate.healthVerified = true;
      candidate.verified = true;
      candidate.association = candidate.metadataVerified
        ? 'runtime metadata + live health attestation + process start time'
        : 'live health attestation + process start time';
      candidate.command = healthProbe.body.runtime.argv.map(quote).join(' ');
    }
    candidates.push(candidate);
  }

  const verified = candidates.filter((candidate) => candidate.verified);
  const unrelatedPortOwners = port.owners.filter((pid) => !verified.some((candidate) => candidate.pid === pid));
  const metadataInfo = metadata?.pid ? (infoByPid.get(metadata.pid) || processInfo(metadata.pid)) : null;
  const metadataState = metadataDisposition(metadata, metadataInfo);
  if (port.error) inspectionErrors.push(`port ${PORT}: ${port.error}`);
  return { metadata, metadataState, history, storePid, port, rootProbe, healthProbe, candidates, verified, unrelatedPortOwners, inspectionErrors };
}

function printState(state) {
  const inspectionFailed = state.inspectionErrors.length > 0;
  const running = state.verified.length > 0;
  const primary = state.verified.find((candidate) => candidate.ownsPort) || state.verified[0] || null;
  const healthStatus = state.rootProbe.status ?? 'unreachable';
  const healthy = Boolean(primary && primary.ownsPort && primary.healthVerified && state.rootProbe.ok);
  console.log(`LandOS: ${inspectionFailed && !running ? 'UNKNOWN (process inspection failed)' : running ? (healthy ? 'RUNNING (healthy)' : 'RUNNING (unhealthy)') : 'STOPPED'}`);
  console.log(`PID: ${primary?.pid ?? '-'}`);
  console.log(`Process start time: ${primary?.info?.startTime ?? '-'}`);
  console.log(`Full verified command: ${primary?.command || (primary?.legacyVerified ? `${quote(primary.info.executable)} ${quote('dist/index.js')} (legacy relative command)` : '-')}`);
  console.log(`Repository: ${ROOT}`);
  console.log(`Repository association: ${primary ? `verified (${primary.association})` : 'none'}`);
  console.log(`Port ${PORT}: ${state.port.error ? `UNKNOWN (${state.port.error})` : state.port.owners.length ? `LISTENING (PID ${state.port.owners.join(', ')})` : 'free'}`);
  console.log(`HTTP status: ${healthStatus}${state.rootProbe.reason ? ` (${state.rootProbe.reason})` : ''}`);
  console.log(`URL: ${URL}`);
  console.log(`Stdout log: ${STDOUT_LOG}`);
  console.log(`Stderr log: ${STDERR_LOG}`);
  console.log(`Application log: ${MAIN_LOG}`);
  console.log(`Runtime metadata: ${METADATA_FILE}`);
  console.log(`Runtime metadata stale: ${state.metadataState === 'unknown' ? 'unknown (inspection failed)' : state.metadataState === 'stale' ? 'yes' : 'no'}`);
  console.log(`Multiple matching processes: ${state.verified.length > 1 ? `yes (${state.verified.map((item) => item.pid).join(', ')})` : 'no'}`);
  console.log(`Unrelated process owns port ${PORT}: ${state.unrelatedPortOwners.length ? `yes (${state.unrelatedPortOwners.join(', ')})` : 'no'}`);
  if (primary && !primary.ownsPort) console.log('Warning: verified LandOS process does not own the dashboard port.');
  if (running && !state.rootProbe.ok) console.log(`Health failure: ${state.rootProbe.reason || `HTTP ${state.rootProbe.status}`}`);
  for (const error of state.inspectionErrors) console.log(`Inspection failure: ${error}`);
}

function acquireOperationLock(operation) {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = crypto.randomUUID();
    try {
      const fd = fs.openSync(OPERATION_LOCK, 'wx', 0o600);
      try {
        fs.writeFileSync(fd, `${JSON.stringify({ pid: process.pid, token, operation, createdAt: new Date().toISOString() })}\n`);
      } catch (error) {
        try { fs.closeSync(fd); } catch { /* preserve write failure */ }
        try { fs.unlinkSync(OPERATION_LOCK); } catch { /* preserve write failure */ }
        throw error;
      }
      return () => {
        try { fs.closeSync(fd); } catch { /* already closed */ }
        const current = readJson(OPERATION_LOCK);
        if (current?.token !== token) return;
        try { fs.unlinkSync(OPERATION_LOCK); } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
        }
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const current = readJson(OPERATION_LOCK);
      const owner = current?.pid ? processInfo(current.pid) : { alive: false };
      const fileAgeMs = Date.now() - fs.statSync(OPERATION_LOCK).mtimeMs;
      const disposition = operationLockDisposition(current, owner, fileAgeMs);
      if (disposition !== 'recover') {
        throw new Error(`Another LandOS runtime operation is active: ${current?.operation || 'unknown'} (PID ${current?.pid || 'unknown'}).`);
      }
      const stale = `${OPERATION_LOCK}.stale-${process.pid}-${Date.now()}`;
      try { fs.renameSync(OPERATION_LOCK, stale); try { fs.unlinkSync(stale); } catch { /* harmless */ } } catch (renameError) {
        if (renameError?.code !== 'ENOENT') throw renameError;
      }
    }
  }
  throw new Error(`Could not acquire ${OPERATION_LOCK}.`);
}

function operationLockDisposition(current, owner, fileAgeMs, now = Date.now()) {
  if (owner?.inspectionFailed) return 'blocked_inspection';
  const createdAgeMs = now - Date.parse(current?.createdAt || '');
  const ageMs = Number.isFinite(createdAgeMs) ? createdAgeMs : fileAgeMs;
  if (owner?.alive && ageMs < OPERATION_STALE_MS) return 'active';
  if (!current && fileAgeMs < OPERATION_STALE_MS) return 'active_unknown';
  return 'recover';
}

function sanitizeEnvironment(runtimeId, source = process.env) {
  const values = new Map();
  const pathParts = [];
  for (const [key, value] of Object.entries(source)) {
    if (value == null) continue;
    const folded = key.toUpperCase();
    if (folded === 'PATH') {
      pathParts.push(...value.split(';').filter(Boolean));
      continue;
    }
    if (!values.has(folded)) values.set(folded, { key, value });
  }
  const systemRoot = source.SystemRoot || source.SYSTEMROOT || 'C:\\Windows';
  const required = [path.dirname(process.execPath), path.join(systemRoot, 'System32'), systemRoot, path.join(systemRoot, 'System32', 'Wbem'), path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0')];
  const uniquePath = [];
  const seen = new Set();
  for (const part of [...required, ...pathParts]) {
    const folded = part.replace(/[\\/]+$/u, '').toLowerCase();
    if (folded && !seen.has(folded)) { seen.add(folded); uniquePath.push(part); }
  }
  const environment = {};
  for (const { key, value } of values.values()) environment[key] = value;
  for (const key of Object.keys(environment)) if (key.toUpperCase() === 'PATH') delete environment[key];
  environment.Path = uniquePath.join(';');
  environment.LANDOS_RUNTIME_ID = runtimeId;
  environment.LANDOS_RUNTIME_ROOT = ROOT;
  environment.DASHBOARD_PORT = String(PORT);
  environment.INIT_CWD = ROOT;
  return environment;
}

async function waitForExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const info = processInfo(pid);
    if (info.inspectionFailed) throw new Error(`Could not verify whether PID ${pid} exited: ${info.reason}`);
    if (!info.alive) return true;
    await sleep(250);
  }
  const finalInfo = processInfo(pid);
  if (finalInfo.inspectionFailed) throw new Error(`Could not verify whether PID ${pid} exited: ${finalInfo.reason}`);
  return !finalInfo.alive;
}

async function terminateCandidate(candidate) {
  const before = processInfo(candidate.pid);
  if (before.inspectionFailed) throw new Error(`Could not safely inspect PID ${candidate.pid}: ${before.reason}`);
  if (!before.alive) return { pid: candidate.pid, stopped: true, forced: false };
  if (!processStartMatches(before.startTime, candidate.info.startTime)) throw new Error(`PID ${candidate.pid} was reused; refusing to terminate it.`);
  const taskkill = windowsPath('taskkill');
  const graceful = spawnSync(taskkill, ['/PID', String(candidate.pid)], { cwd: ROOT, encoding: 'utf8', timeout: COMMAND_TIMEOUT_MS, windowsHide: true });
  if (await waitForExit(candidate.pid, Math.min(3_000, STOP_TIMEOUT_MS))) return { pid: candidate.pid, stopped: true, forced: false };
  const forced = spawnSync(taskkill, ['/F', '/T', '/PID', String(candidate.pid)], { cwd: ROOT, encoding: 'utf8', timeout: COMMAND_TIMEOUT_MS, windowsHide: true });
  if (await waitForExit(candidate.pid, STOP_TIMEOUT_MS)) return { pid: candidate.pid, stopped: true, forced: true };
  const reason = [graceful.stderr, graceful.stdout, forced.stderr, forced.stdout].filter(Boolean).join(' ').trim();
  throw new Error(`PID ${candidate.pid} did not exit within ${STOP_TIMEOUT_MS}ms.${reason ? ` taskkill: ${reason}` : ''}`);
}

function cleanMetadataForPid(pid) {
  removeIfOwned(METADATA_FILE, (value) => value?.pid === pid);
  try {
    const info = processInfo(pid);
    if (!info.inspectionFailed && readStorePid() === pid && !info.alive) fs.unlinkSync(STORE_PID_FILE);
  } catch { /* stale metadata cleanup is best effort */ }
}

async function stopInternal() {
  const state = await gatherState();
  if (state.inspectionErrors.length) throw new Error(`Cannot safely stop LandOS because process inspection failed: ${state.inspectionErrors.join('; ')}`);
  if (state.verified.length === 0) {
    if (state.metadataState === 'stale') removeIfOwned(METADATA_FILE, () => true);
    const staleStorePid = state.storePid ? processInfo(state.storePid) : null;
    if (state.storePid && !staleStorePid?.alive) {
      try { fs.unlinkSync(STORE_PID_FILE); } catch { /* already absent */ }
    }
    console.log('LandOS is already stopped.');
    if (state.unrelatedPortOwners.length) console.log(`Port ${PORT} is owned by unrelated PID ${state.unrelatedPortOwners.join(', ')}; it was not touched.`);
    return [];
  }
  const results = [];
  for (const candidate of state.verified) {
    console.log(`Stopping verified LandOS PID ${candidate.pid} (${candidate.association})...`);
    const result = await terminateCandidate(candidate);
    results.push(result);
    cleanMetadataForPid(candidate.pid);
    console.log(`Stopped PID ${candidate.pid}${result.forced ? ' (forced fallback)' : ' (graceful request)'}.`);
  }
  const finalState = await gatherState();
  if (finalState.verified.length) throw new Error(`Verified LandOS process still running: ${finalState.verified.map((item) => item.pid).join(', ')}`);
  return results;
}

function logTail(file, lines = 80) {
  if (!fs.existsSync(file)) return '(not created yet)';
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    if (size === 0) return '(empty)';
    const length = Math.min(size, 256 * 1024);
    const buffer = Buffer.allocUnsafe(length);
    fs.readSync(fd, buffer, 0, length, size - length);
    return buffer.toString('utf8').split(/\r?\n/u).slice(-lines).join('\n').trimEnd() || '(empty)';
  } finally { fs.closeSync(fd); }
}

function compactApplicationLog() {
  if (!fs.existsSync(MAIN_LOG)) return;
  const size = fs.statSync(MAIN_LOG).size;
  if (size <= MAIN_LOG_MAX_BYTES) return;
  const fd = fs.openSync(MAIN_LOG, 'r');
  let buffer;
  try {
    buffer = Buffer.allocUnsafe(MAIN_LOG_KEEP_BYTES);
    fs.readSync(fd, buffer, 0, buffer.length, size - buffer.length);
  } finally { fs.closeSync(fd); }
  const firstNewline = buffer.indexOf(0x0a);
  const retained = firstNewline >= 0 ? buffer.subarray(firstNewline + 1) : buffer;
  fs.writeFileSync(MAIN_LOG, retained);
  console.log(`Compacted application log from ${size} to ${retained.length} bytes.`);
}

async function terminateStartedProcess(metadata) {
  const info = processInfo(metadata.pid);
  if (info.inspectionFailed) throw new Error(`Could not inspect failed launch PID ${metadata.pid}: ${info.reason}. Runtime metadata was retained for recovery.`);
  if (!info.alive) { cleanMetadataForPid(metadata.pid); return; }
  if (!metadataAssociation(metadata, info)) throw new Error(`Failed launch PID ${metadata.pid} no longer matches its start metadata; refusing to terminate it.`);
  await terminateCandidate({ pid: metadata.pid, info, metadata, verified: true, association: 'failed launch metadata' });
  cleanMetadataForPid(metadata.pid);
}

function startDecision(state) {
  if (state.inspectionErrors?.length) return { action: 'error', reason: `Process inspection failed: ${state.inspectionErrors.join('; ')}` };
  if (state.verified.length > 1) return { action: 'error', reason: `Multiple verified LandOS processes exist (${state.verified.map((item) => item.pid).join(', ')}). Run npm run landos:stop before starting.` };
  if (state.unrelatedPortOwners.length) return { action: 'error', reason: `Port ${PORT} is occupied by unrelated PID ${state.unrelatedPortOwners.join(', ')}. It was not touched.` };
  if (state.verified.length === 1) {
    const current = state.verified[0];
    if (current.ownsPort && current.healthVerified && state.rootProbe.ok) return { action: 'already_running', pid: current.pid };
    return { action: 'error', reason: `Verified LandOS PID ${current.pid} exists but is unhealthy or does not own port ${PORT}. Use npm run landos:restart for bounded recovery.` };
  }
  return { action: 'launch' };
}

async function startInternal() {
  const before = await gatherState();
  const decision = startDecision(before);
  if (decision.action === 'error') throw new Error(decision.reason);
  if (decision.action === 'already_running') {
    console.log(`LandOS is already running and healthy (PID ${decision.pid}).`);
    console.log(`URL: ${URL}`);
    return decision.pid;
  }
  if (before.storePid && before.candidates.some((candidate) => candidate.pid === before.storePid)) throw new Error(`Live PID ${before.storePid} owns ${STORE_PID_FILE} but could not be associated with this repository. Refusing to start or kill it.`);
  if (before.metadataState === 'stale') removeIfOwned(METADATA_FILE, () => true);
  if (!fs.existsSync(ENTRY)) throw new Error(`Backend build is missing: ${ENTRY}. Run npm run build:server first.`);

  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  compactApplicationLog();
  const runtimeId = crypto.randomUUID();
  const args = [ENTRY, `--landos-runtime-id=${runtimeId}`, `--landos-runtime-root=${ROOT}`];
  const command = [process.execPath, ...args].map(quote).join(' ');
  fs.writeFileSync(STDOUT_LOG, `[landos-runtime] ${new Date().toISOString()}\n[landos-runtime] ${command}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.writeFileSync(STDERR_LOG, '', { encoding: 'utf8', mode: 0o600 });
  const launched = spawnSync(windowsPath('powershell'), [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', DETACHED_LAUNCHER,
    '-NodePath', process.execPath,
    '-EntryPoint', ENTRY,
    '-RuntimeId', runtimeId,
    '-RepoRoot', ROOT,
    '-StdoutPath', STDOUT_LOG,
    '-StderrPath', STDERR_LOG,
  ], { cwd: ROOT, env: sanitizeEnvironment(runtimeId, process.env), encoding: 'utf8', timeout: COMMAND_TIMEOUT_MS * 2, windowsHide: true });
  if (launched.error || launched.status !== 0) {
    throw new Error(`Native detached launch failed: ${launched.error?.message || launched.stderr || launched.stdout || `exit ${launched.status}`}`.trim());
  }
  let launchedData;
  try { launchedData = JSON.parse((launched.stdout || '').trim()); } catch { throw new Error(`Native detached launcher returned invalid output: ${(launched.stdout || launched.stderr || '').trim()}`); }
  const child = { pid: Number(launchedData.pid) };
  if (!Number.isInteger(child.pid) || child.pid <= 0) throw new Error('Windows did not return a child PID.');
  if (!Number.isFinite(Date.parse(launchedData.processStartTime || ''))) throw new Error('Windows did not return the child process start time.');
  const metadata = {
    schema: 1,
    pid: child.pid,
    processStartTime: launchedData.processStartTime,
    runtimeId,
    repoRoot: ROOT,
    entryPoint: ENTRY,
    executable: process.execPath,
    args,
    command,
    url: URL,
    stdoutLog: STDOUT_LOG,
    stderrLog: STDERR_LOG,
    startedAt: new Date().toISOString(),
    launcherPid: process.pid,
  };
  writeJsonAtomic(METADATA_FILE, metadata);

  try {
    let info = null;
    const inspectDeadline = Date.now() + 3_000;
    while (Date.now() < inspectDeadline) {
      info = processInfo(child.pid);
      if (info.inspectionFailed) throw new Error(`Could not inspect started PID ${child.pid}: ${info.reason}`);
      if (info.alive) break;
      await sleep(100);
    }
    if (!info?.alive) throw new Error(`Started PID ${child.pid}, but it exited before process verification.\n${logTail(STDERR_LOG, 30)}`);
    if (!metadataAssociation(metadata, info)) throw new Error(`Started PID ${child.pid} did not match its native process metadata.`);
    recordHistory(metadata);
    const dashboardToken = await readDashboardToken();
    const healthUrl = authenticatedHealthUrl(dashboardToken);
    const deadline = Date.now() + START_TIMEOUT_MS;
    let lastReason = 'startup not yet observed';
    while (Date.now() < deadline) {
      info = processInfo(child.pid);
      if (!metadataAssociation(metadata, info)) throw new Error(`PID ${child.pid} exited during startup.`);
      const [rootProbe, healthProbe] = await Promise.all([httpProbe(URL), httpProbe(healthUrl, true)]);
      if (rootProbe.ok && healthProbe.ok && healthAssociation(healthProbe.body?.runtime, { pid: child.pid, info, metadata })) {
        const owners = portOwners().owners;
        if (owners.length === 1 && owners[0] === child.pid) {
          await sleep(1_250);
          const stableInfo = processInfo(child.pid);
          const stableHealth = await httpProbe(healthUrl, true);
          if (metadataAssociation(metadata, stableInfo) && stableHealth.ok && healthAssociation(stableHealth.body?.runtime, { pid: child.pid, info: stableInfo, metadata })) {
            console.log(`LandOS started successfully.`);
            console.log(`PID: ${child.pid}`);
            console.log(`URL: ${URL}`);
            console.log(`Repository: ${ROOT}`);
            console.log(`Stdout log: ${STDOUT_LOG}`);
            console.log(`Stderr log: ${STDERR_LOG}`);
            console.log(`Health: HTTP 200 (${stableHealth.elapsedMs}ms)`);
            return child.pid;
          }
          lastReason = 'process or health attestation did not remain stable';
        } else {
          lastReason = `port owner mismatch: ${owners.join(', ') || 'none'}`;
        }
      } else {
        lastReason = rootProbe.reason || healthProbe.reason || 'runtime identity mismatch';
      }
      await sleep(500);
    }
    throw new Error(`LandOS PID ${child.pid} did not become healthy within ${START_TIMEOUT_MS}ms (${lastReason}).`);
  } catch (error) {
    let recoveryFailure = '';
    try { await terminateStartedProcess(metadata); } catch (recoveryError) { recoveryFailure = `\nRecovery failure: ${recoveryError.message}`; }
    throw new Error(`${error.message}${recoveryFailure}\n--- stderr ---\n${logTail(STDERR_LOG, 40)}\n--- stdout ---\n${logTail(STDOUT_LOG, 40)}`);
  }
}

async function commandStatus() {
  const state = await gatherState();
  printState(state);
  if (state.inspectionErrors.length) return 2;
  return state.verified.length === 1 && state.verified[0].healthVerified && state.rootProbe.ok && !state.unrelatedPortOwners.length ? 0 : 1;
}

async function commandHealth() {
  const metadata = readJson(METADATA_FILE);
  const dashboardToken = await readDashboardToken();
  const [rootProbe, healthProbe] = await Promise.all([httpProbe(URL), httpProbe(authenticatedHealthUrl(dashboardToken), true)]);
  console.log(`URL: ${URL}`);
  console.log(`Timeout: ${HTTP_TIMEOUT_MS}ms`);
  console.log(`Root HTTP status: ${rootProbe.status ?? 'unreachable'}`);
  console.log(`Health HTTP status: ${healthProbe.status ?? 'unreachable'}`);
  if (!rootProbe.ok || !healthProbe.ok) {
    console.log(`Failure: ${rootProbe.reason || healthProbe.reason || 'health check failed'}`);
    return 1;
  }
  const runtime = healthProbe.body?.runtime;
  if (metadata && runtime?.runtimeId !== metadata.runtimeId) {
    console.log('Failure: runtime identity did not match current metadata');
    return 1;
  }
  console.log(`Health: OK (${Math.max(rootProbe.elapsedMs, healthProbe.elapsedMs)}ms)`);
  console.log(`PID: ${runtime?.pid ?? 'not reported by this build'}`);
  return 0;
}

function commandLogs() {
  console.log(`=== stdout: ${STDOUT_LOG} ===`);
  console.log(logTail(STDOUT_LOG));
  console.log(`\n=== stderr: ${STDERR_LOG} ===`);
  console.log(logTail(STDERR_LOG));
  console.log(`\n=== application: ${MAIN_LOG} ===`);
  console.log(logTail(MAIN_LOG));
  return 0;
}

async function withOperationLock(operation, callback) {
  const release = acquireOperationLock(operation);
  try { return await callback(); } finally { release(); }
}

async function main() {
  if (process.platform !== 'win32') throw new Error('The canonical LandOS local runtime currently supports Windows only.');
  const command = (process.argv[2] || '').toLowerCase();
  switch (command) {
    case 'status': return commandStatus();
    case 'health': return commandHealth();
    case 'logs': return commandLogs();
    case 'start': return withOperationLock('start', startInternal).then(() => 0);
    case 'stop': return withOperationLock('stop', stopInternal).then(() => 0);
    case 'restart': return withOperationLock('restart', async () => { await stopInternal(); await sleep(500); await startInternal(); return 0; });
    default:
      console.error('Usage: node scripts/runtime/landos-runtime.mjs <status|start|stop|restart|logs|health>');
      return 2;
  }
}

export {
  ENTRY,
  ROOT,
  historyAssociation,
  httpProbe,
  logTail,
  metadataAssociation,
  metadataDisposition,
  nextHistory,
  operationLockDisposition,
  processStartMatches,
  quote,
  samePath,
  sanitizeEnvironment,
  startDecision,
};

if (process.argv[1] && samePath(process.argv[1], fileURLToPath(import.meta.url))) {
  main().then((code) => { process.exitCode = Number.isInteger(code) ? code : 0; }).catch((error) => {
    console.error(`LandOS runtime error: ${error.message}`);
    process.exitCode = 1;
  });
}
