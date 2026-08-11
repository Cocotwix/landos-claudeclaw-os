import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const asJson = process.argv.includes('--json');
const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
const limit = Math.min(Math.max(Number(limitArg?.split('=')[1] ?? 50), 1), 200);
const terms = process.argv.slice(2).filter((arg) => !arg.startsWith('--')).join(' ').trim().toLowerCase();

if (!terms) {
  console.error('Usage: node scripts/knowledge/query-landos-knowledge.mjs <terms> [--json] [--limit=N]');
  process.exitCode = 2;
} else {
  const roots = [
    path.join(workspace, 'docs', 'landos', 'knowledge'),
    path.join(workspace, 'docs', 'landos', 'property-intelligence-sop.md'),
    path.join(workspace, '.landos', 'CODING_SESSION_PROTOCOL.md'),
    path.join(workspace, '.landos', 'PERMANENT_MEMORY.md'),
  ];
  const words = terms.split(/\s+/).filter(Boolean);
  const files = [];
  const collect = (target) => {
    if (!fs.existsSync(target)) return;
    const stat = fs.statSync(target);
    if (stat.isFile() && target.endsWith('.md')) { files.push(target); return; }
    if (!stat.isDirectory()) return;
    for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      collect(path.join(target, entry.name));
    }
  };
  roots.forEach(collect);
  const hits = [];
  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const normalized = lines[index].toLowerCase();
      if (words.every((word) => normalized.includes(word))) {
        hits.push({ path: path.relative(workspace, file).replace(/\\/g, '/'), line: index + 1, text: lines[index].trim() });
        if (hits.length >= limit) break;
      }
    }
    if (hits.length >= limit) break;
  }
  if (asJson) console.log(JSON.stringify({ query: terms, count: hits.length, hits }, null, 2));
  else for (const hit of hits) console.log(`${hit.path}:${hit.line}: ${hit.text}`);
  if (!hits.length) process.exitCode = 1;
}

