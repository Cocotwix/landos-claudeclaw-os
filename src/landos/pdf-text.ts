// Dependency-free text probing for standard (non-encrypted) PDFs whose content
// streams carry literal string operands. Used by the zoning ordinance adapter
// to verify that retrieved OFFICIAL documents actually contain the provisions
// a jurisdiction configuration transcribes — extraction is verification, never
// fabrication. Layout fidelity is not a goal; anchor-substring presence is.

import zlib from 'node:zlib';

function decodePdfString(body: string): string {
  let out = '';
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch !== '\\') { out += ch; continue; }
    const next = body[i + 1];
    if (next === 'n') { out += '\n'; i += 1; }
    else if (next === 'r') { out += '\r'; i += 1; }
    else if (next === 't') { out += '\t'; i += 1; }
    else if (next === 'b' || next === 'f') { i += 1; }
    else if (next === '(' || next === ')' || next === '\\') { out += next; i += 1; }
    else if (next >= '0' && next <= '7') {
      const octal = /^[0-7]{1,3}/.exec(body.slice(i + 1, i + 4))![0];
      out += String.fromCharCode(parseInt(octal, 8));
      i += octal.length;
    }
  }
  return out;
}

/**
 * Extract the visible text of a PDF by inflating its content streams and
 * collecting literal string operands of the text-showing operators. Works for
 * ordinary generated PDFs (Word/print exports); returns '' when nothing can
 * be decoded so callers can report an honest extraction gap.
 */
export function extractPdfText(bytes: Buffer): string {
  const raw = bytes.toString('latin1');
  const pieces: string[] = [];
  let index = 0;
  while ((index = raw.indexOf('stream', index)) !== -1) {
    let start = index + 6;
    if (raw[start] === '\r') start += 1;
    if (raw[start] === '\n') start += 1;
    const end = raw.indexOf('endstream', start);
    if (end === -1) break;
    let content: string | null = null;
    try {
      content = zlib.inflateSync(bytes.subarray(start, end)).toString('latin1');
    } catch {
      content = raw.slice(start, end);
    }
    index = end + 9;
    if (!content || !/\bBT\b/.test(content)) continue;
    const tokens = /\((?:\\.|[^\\()])*\)|\bTJ\b|\bTj\b|\bTd\b|\bTD\b|\bT\*\b|\bTm\b|\bET\b/g;
    let pending: string[] = [];
    for (let match = tokens.exec(content); match; match = tokens.exec(content)) {
      const token = match[0];
      if (token.startsWith('(')) {
        pending.push(decodePdfString(token.slice(1, -1)));
      } else if (token === 'TJ' || token === 'Tj') {
        if (pending.length) { pieces.push(pending.join('')); pending = []; }
      } else {
        pieces.push('\n');
        pending = [];
      }
    }
  }
  return pieces.join(' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .replace(/ {2,}/g, ' ');
}

/** Whitespace-insensitive containment check for anchor phrases. */
export function pdfTextIncludes(text: string, anchor: string): boolean {
  const normalize = (value: string) => value.replace(/\s+/g, ' ').toLowerCase();
  return normalize(text).includes(normalize(anchor));
}

/**
 * Honest page count for a retained PDF: the page-tree /Count value (max wins
 * for nested trees), cross-checked against the number of /Type /Page objects.
 * Returns null when the bytes are not a recognizable PDF.
 */
export function countPdfPages(bytes: Buffer): number | null {
  const raw = bytes.toString('latin1');
  if (!raw.startsWith('%PDF-')) return null;
  const counts = [...raw.matchAll(/\/Count\s+(\d+)/g)].map((match) => Number(match[1]));
  const treeCount = counts.length ? Math.max(...counts) : 0;
  const pageObjects = (raw.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  const pages = Math.max(treeCount, pageObjects);
  return pages > 0 ? pages : null;
}
