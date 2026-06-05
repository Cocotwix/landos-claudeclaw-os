#!/usr/bin/env node
// Converts a markdown file to a print-ready PDF via Chrome headless.
// Usage: node gen-pdf.js <input.md> <output.pdf>

import { marked } from 'marked';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: node gen-pdf.js <input.md> <output.pdf>');
  process.exit(1);
}

const inputPath  = resolve(args[0]);
const outputPath = resolve(args[1]);

if (!existsSync(inputPath)) {
  console.error(`Input file not found: ${inputPath}`);
  process.exit(1);
}

const markdown = readFileSync(inputPath, 'utf-8');
const body     = marked.parse(markdown);

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  @page {
    size: A4;
    margin: 20mm 18mm 20mm 18mm;
  }
  * { box-sizing: border-box; }
  body {
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 11pt;
    line-height: 1.55;
    color: #111;
  }
  h1 {
    font-size: 18pt;
    margin-top: 0;
    border-bottom: 2px solid #222;
    padding-bottom: 4px;
  }
  h2 {
    font-size: 14pt;
    border-bottom: 1px solid #999;
    padding-bottom: 2px;
    margin-top: 1.4em;
  }
  h3 { font-size: 12pt; margin-top: 1.2em; }
  h4 { font-size: 11pt; margin-top: 1em; }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 0.8em 0;
    font-size: 10pt;
  }
  th, td {
    border: 1px solid #aaa;
    padding: 5px 8px;
    text-align: left;
    vertical-align: top;
  }
  th { background: #e8e8e8; font-weight: bold; }
  tr:nth-child(even) { background: #f6f6f6; }
  code {
    font-family: 'Courier New', monospace;
    font-size: 9pt;
    background: #f0f0f0;
    padding: 1px 3px;
    border-radius: 2px;
  }
  pre {
    background: #f0f0f0;
    border: 1px solid #ddd;
    border-radius: 3px;
    padding: 10px 12px;
    font-size: 9pt;
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-word;
  }
  pre code { background: none; padding: 0; }
  blockquote {
    border-left: 3px solid #aaa;
    margin: 0.8em 0 0.8em 1em;
    padding: 0.3em 0.8em;
    color: #444;
    font-style: italic;
  }
  ul, ol { margin: 0.4em 0 0.4em 1.5em; padding: 0; }
  li { margin-bottom: 0.2em; }
  hr { border: none; border-top: 1px solid #ccc; margin: 1.2em 0; }
  a { color: #1a5276; }
  @media print {
    h1, h2, h3 { page-break-after: avoid; }
    table, pre, blockquote { page-break-inside: avoid; }
  }
</style>
</head>
<body>
${body}
</body>
</html>`;

const tmpHtml = join(tmpdir(), `duke-dd-${Date.now()}.html`);
writeFileSync(tmpHtml, html, 'utf-8');

const chromeCandidates = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

const chrome = chromeCandidates.find(p => existsSync(p)) ?? 'google-chrome';

const fileUrl = `file:///${tmpHtml.replace(/\\/g, '/')}`;

const result = spawnSync(
  chrome,
  [
    '--headless',
    '--disable-gpu',
    '--no-sandbox',
    `--print-to-pdf=${outputPath}`,
    '--print-to-pdf-no-header',
    fileUrl,
  ],
  { stdio: 'pipe' }
);

try { unlinkSync(tmpHtml); } catch { /* best-effort cleanup */ }

if (result.status !== 0) {
  const stderr = result.stderr?.toString().trim() ?? '';
  console.error(`Chrome exited with code ${result.status}`);
  if (stderr) console.error(stderr);
  process.exit(result.status || 1);
}

console.log(`PDF written to: ${outputPath}`);
