// Forge existing-agent inspector — host adapter (read-only filesystem).
//
// This is NOT Forge Core. It reads existing agent folders so the pure core
// (agent-retrofit.ts) can reconstruct and compare. It is strictly read-only:
// it lists candidate agent folders and reads a narrow allowlist of text files.
// It never writes, moves, renames, or deletes anything, never descends into
// excluded directories, and never reads .env or secret-looking files.

import fs from 'fs';
import path from 'path';

import { LANDOS_AGENTS_DIR } from '../config.js';
import type { ExistingAgentFile } from './agent-retrofit.js';
import type { TargetFileMeta } from './writeback-proposal.js';

// Directories never inspected, even if present inside an agent folder.
const EXCLUDED_DIRS = new Set([
  'node_modules', '.git', 'store', 'logs', 'dist', 'build', '.cache', 'coverage', '.next',
]);

// Only these extensions are read. Everything else (images, binaries, lockfiles)
// is ignored.
const ALLOWED_EXT = new Set(['.md', '.yaml', '.yml', '.json', '.txt']);

// Files whose name looks secret-bearing are never read, regardless of extension.
function isSecretLikeName(name: string): boolean {
  const n = name.toLowerCase();
  // Split the name into tokens on common separators so "key" is matched as its
  // own token (key.json, api-key.json, private-key.txt, api_key.yaml) without
  // over-blocking ordinary words that merely contain "key" (monkey.json,
  // keyword.md). Plural "keys" is treated the same as "key".
  const tokens = n.split(/[-_.\s]+/).filter(Boolean);
  const hasKeyToken = tokens.some((t) => t === 'key' || t === 'keys');
  return (
    n.startsWith('.env') ||
    n.includes('secret') ||
    n.includes('token') ||
    n.includes('credential') ||
    n.includes('.pem') ||
    n.includes('.key') ||
    hasKeyToken
  );
}

function isAllowedFile(name: string): boolean {
  if (name.startsWith('.')) return false;
  if (isSecretLikeName(name)) return false;
  return ALLOWED_EXT.has(path.extname(name).toLowerCase());
}

const MAX_FILE_BYTES = 200_000;
const MAX_FILES = 40;

export interface ExistingAgentCandidate {
  slug: string;
  displayName: string;
  /** Folder path relative to the agents directory. */
  folderPath: string;
  detectedFiles: string[];
  detectedPrimaryFile?: string;
  status?: string;
  safeToInspect: boolean;
  warnings: string[];
}

/** A subfolder "looks like an agent" when it has a primary instruction file or
 *  an agent config file. */
function looksLikeAgent(files: string[]): boolean {
  const lower = files.map((f) => f.toLowerCase());
  return (
    lower.includes('claude.md') ||
    lower.includes('agent.md') ||
    lower.includes('agent.yaml') ||
    lower.includes('agent.yml')
  );
}

function titleCase(slug: string): string {
  const words = slug.split('-').filter(Boolean);
  if (!words.length) return slug;
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function readDisplayName(dir: string, files: string[]): string | undefined {
  const cfg = files.find((f) => /^agent\.ya?ml$/i.test(f));
  if (!cfg) return undefined;
  try {
    const text = fs.readFileSync(path.join(dir, cfg), 'utf-8');
    const m = /^name\s*:\s*(.+)$/im.exec(text);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  } catch { /* ignore */ }
  return undefined;
}

// Validate a slug so it can never escape the agents directory.
function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9._-]*$/i.test(slug) && !slug.includes('..');
}

/**
 * List candidate existing agents in the allowlisted agents directory. Read-only.
 * Returns an empty list if the directory is absent.
 */
export function listExistingAgentCandidates(
  agentsDir: string = LANDOS_AGENTS_DIR,
): ExistingAgentCandidate[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(agentsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const candidates: ExistingAgentCandidate[] = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    if (EXCLUDED_DIRS.has(ent.name) || ent.name.startsWith('.')) continue;
    const slug = ent.name;
    const dir = path.join(agentsDir, slug);
    let topFiles: string[];
    try {
      topFiles = fs.readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isFile())
        .map((d) => d.name);
    } catch {
      continue;
    }
    if (!looksLikeAgent(topFiles)) continue;

    const detected = topFiles.filter(isAllowedFile).sort();
    const primary = detected.find((f) => /^claude\.md$/i.test(f) || /^agent\.md$/i.test(f));
    const warnings: string[] = [];
    if (!primary) warnings.push('No primary instruction file (CLAUDE.md / AGENT.md).');
    if (!isValidSlug(slug)) warnings.push('Folder name is not a clean slug.');

    candidates.push({
      slug,
      displayName: readDisplayName(dir, topFiles) || titleCase(slug),
      folderPath: path.posix.join(path.basename(agentsDir), slug),
      detectedFiles: detected,
      detectedPrimaryFile: primary,
      safeToInspect: isValidSlug(slug),
      warnings,
    });
  }
  candidates.sort((a, b) => a.slug.localeCompare(b.slug));
  return candidates;
}

/**
 * Read the allowlisted text files of one existing agent for inspection.
 * Read-only. Reads top-level allowlisted files plus markdown under a `docs/`
 * subfolder (one level). Skips excluded dirs and secret-looking files. Returns
 * undefined when the slug is invalid or the folder is absent.
 */
export function inspectAgentFiles(
  slug: string,
  agentsDir: string = LANDOS_AGENTS_DIR,
): { relativeFolderPath: string; files: ExistingAgentFile[] } | undefined {
  if (!isValidSlug(slug)) return undefined;
  const dir = path.resolve(agentsDir, slug);
  // Defense in depth: the resolved path must stay inside the agents directory.
  const root = path.resolve(agentsDir);
  if (dir !== root && !dir.startsWith(root + path.sep)) return undefined;
  let stat: fs.Stats;
  try {
    stat = fs.statSync(dir);
  } catch {
    return undefined;
  }
  if (!stat.isDirectory()) return undefined;

  const files: ExistingAgentFile[] = [];
  const pushFile = (absPath: string, relPath: string) => {
    if (files.length >= MAX_FILES) return;
    try {
      const s = fs.statSync(absPath);
      if (!s.isFile() || s.size > MAX_FILE_BYTES) return;
      files.push({ path: relPath, content: fs.readFileSync(absPath, 'utf-8') });
    } catch { /* skip unreadable */ }
  };

  // Top-level allowlisted files.
  let top: string[] = [];
  try {
    top = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile()).map((d) => d.name);
  } catch { /* none */ }
  for (const name of top.filter(isAllowedFile).sort()) {
    pushFile(path.join(dir, name), name);
  }

  // One level of docs/.
  const docsDir = path.join(dir, 'docs');
  try {
    if (fs.statSync(docsDir).isDirectory()) {
      const docFiles = fs.readdirSync(docsDir, { withFileTypes: true })
        .filter((d) => d.isFile())
        .map((d) => d.name)
        .filter((n) => isAllowedFile(n) && path.extname(n).toLowerCase() === '.md')
        .sort();
      for (const name of docFiles) pushFile(path.join(docsDir, name), `docs/${name}`);
    }
  } catch { /* no docs */ }

  return { relativeFolderPath: path.posix.join(path.basename(agentsDir), slug), files };
}

/**
 * Read-only check of a future writeback target path inside an agent folder.
 * Returns metadata only: whether it exists, its current text (for preview), and
 * whether it would be safe to write to later. Writes nothing. Enforces the same
 * restrictions as inspection: inside the agent folder, no traversal, no excluded
 * dirs, no dotfiles, allowlisted extensions, never secret-named files.
 */
export function inspectTargetPath(
  slug: string,
  relativeTargetPath: string,
  agentsDir: string = LANDOS_AGENTS_DIR,
): TargetFileMeta {
  const rel = relativeTargetPath.replace(/\\/g, '/');
  const base: TargetFileMeta = {
    relativeTargetPath: rel,
    exists: false,
    safeToWriteLater: false,
    riskFlags: [],
  };

  if (!isValidSlug(slug)) {
    base.riskFlags = ['Invalid agent slug.'];
    return base;
  }
  const fileName = rel.split('/').pop() ?? '';
  const segments = rel.split('/').filter(Boolean);
  const risk: string[] = [];

  if (!rel || rel.includes('..') || path.isAbsolute(relativeTargetPath)) {
    risk.push('Path escapes the agent folder.');
  }
  if (segments.some((s) => EXCLUDED_DIRS.has(s) || s.startsWith('.'))) {
    risk.push('Path touches an excluded or hidden directory.');
  }
  if (!isAllowedFile(fileName)) {
    risk.push('Not an allowlisted, non-secret text file.');
  }

  // Resolve and confirm containment inside the agent folder.
  const agentRoot = path.resolve(agentsDir, slug);
  const resolved = path.resolve(agentRoot, rel);
  const inside = resolved === agentRoot
    ? false
    : resolved.startsWith(agentRoot + path.sep);
  if (!inside) risk.push('Resolved path is outside the agent folder.');

  const safeToWriteLater = risk.length === 0;
  let exists = false;
  let currentText: string | undefined;
  if (safeToWriteLater) {
    try {
      const s = fs.statSync(resolved);
      if (s.isFile()) {
        exists = true;
        if (s.size <= MAX_FILE_BYTES) currentText = fs.readFileSync(resolved, 'utf-8');
      } else if (s.isDirectory()) {
        risk.push('Target path is a directory.');
      }
    } catch { /* does not exist: fine for a create */ }
  }

  return {
    relativeTargetPath: rel,
    exists,
    currentText,
    safeToWriteLater: risk.length === 0,
    riskFlags: risk,
  };
}
