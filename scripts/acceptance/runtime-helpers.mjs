import { lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

export function isWithin(root, target) {
  const rel = relative(resolve(root), resolve(target));
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..');
}

export function slug(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLocaleLowerCase('en-US')
    .slice(0, 80) || 'acceptance';
}

export function timestampSlug(timestamp = new Date().toISOString()) {
  return timestamp.replace(/[:.]/g, '-');
}

export async function createAcceptanceRunDirectory(repositoryRoot, sprintName, explicitDirectory) {
  const acceptanceRoot = resolve(repositoryRoot, '.landos', 'acceptance');
  const directory = explicitDirectory
    ? resolve(explicitDirectory)
    : join(acceptanceRoot, `${timestampSlug()}-${slug(sprintName)}`);
  if (!isWithin(acceptanceRoot, directory) || directory === acceptanceRoot) {
    throw new Error('LANDOS_ACCEPTANCE_OUTPUT_DIR must be a new child of .landos/acceptance');
  }
  await mkdir(directory, { recursive: false });
  return directory;
}

export async function writeJsonAtomic(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  await rename(temporary, path);
}

export function sanitizeConsoleText(value) {
  return String(value)
    .replace(/(authorization)(\s*[:=]\s*)(?:bearer\s+)?[^\s,;]+/gi, '$1$2[REDACTED]')
    .replace(/bearer\s+[a-z0-9._~+\/-]+/gi, 'Bearer [REDACTED]')
    .replace(/(cookie|set-cookie|password|secret|api[_-]?key|token)(\s*[:=]\s*)([^\s,;]+)/gi, '$1$2[REDACTED]')
    .replace(/eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g, '[REDACTED_JWT]')
    .slice(0, 4_000);
}

export function safeUrlPath(value) {
  try {
    const url = new URL(value);
    return url.pathname || '/';
  } catch {
    return '/unparseable-url';
  }
}

export function patternMatches(value, patterns) {
  return patterns.some((pattern) => {
    try {
      return new RegExp(pattern, 'i').test(value);
    } catch {
      return value.toLocaleLowerCase('en-US').includes(String(pattern).toLocaleLowerCase('en-US'));
    }
  });
}

export async function resolveApprovedAuth({ repositoryRoot, mode, environment = process.env }) {
  if (mode === 'fixture') return { storageState: undefined, connectUrl: undefined, imported: false, method: 'fixture-none' };
  const storageStateInput = environment.LANDOS_ACCEPTANCE_AUTH_STATE?.trim();
  const connectInput = environment.LANDOS_ACCEPTANCE_CONNECT_URL?.trim();
  if (storageStateInput && connectInput) throw new Error('Choose either LANDOS_ACCEPTANCE_CONNECT_URL or LANDOS_ACCEPTANCE_AUTH_STATE, not both');
  if (connectInput) {
    const url = new URL(connectInput);
    const host = url.hostname.toLocaleLowerCase('en-US');
    if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '::1'].includes(host)) {
      throw new Error('LANDOS_ACCEPTANCE_CONNECT_URL must be an HTTP loopback URL emitted by landos:visual-ready');
    }
    if (url.username || url.password || !url.pathname.startsWith('/connect')) {
      throw new Error('LANDOS_ACCEPTANCE_CONNECT_URL is not an approved LandOS connect bootstrap URL');
    }
    return { storageState: undefined, connectUrl: connectInput, imported: false, method: 'single-use-visual-ready' };
  }
  if (storageStateInput) {
    if (environment.LANDOS_ACCEPTANCE_AUTH_STATE_APPROVED !== '1') {
      throw new Error('External auth-state import requires LANDOS_ACCEPTANCE_AUTH_STATE_APPROVED=1');
    }
    const storageState = resolve(storageStateInput);
    if (isWithin(repositoryRoot, storageState)) {
      throw new Error('Approved auth state must remain outside the repository and acceptance artifacts');
    }
    const stat = await lstat(storageState);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 2 || stat.size > 1_000_000) {
      throw new Error('Approved auth state must be a regular external JSON file smaller than 1 MB');
    }
    const parsed = JSON.parse(await readFile(storageState, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.cookies) || !Array.isArray(parsed.origins)) {
      throw new Error('Approved auth state is not a Playwright storage-state document');
    }
    return { storageState, connectUrl: undefined, imported: true, method: 'approved-external-storage-state' };
  }
  throw new Error('Live isolated acceptance needs a single-use LANDOS_ACCEPTANCE_CONNECT_URL from npm run landos:visual-ready, or an explicitly approved external storage state');
}

export function loopbackBaseUrl(input) {
  const url = new URL(input || 'http://localhost:3141');
  const host = url.hostname.toLocaleLowerCase('en-US');
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '::1'].includes(host) || url.username || url.password) {
    throw new Error('Acceptance base URL must be credential-free HTTP loopback');
  }
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}
