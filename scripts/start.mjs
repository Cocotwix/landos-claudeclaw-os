#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const startsNamedAgent = args.includes('--agent');

if (process.platform === 'win32' && !startsNamedAgent) {
  const runtime = path.join(root, 'scripts', 'runtime', 'landos-runtime.mjs');
  const result = spawnSync(process.execPath, [runtime, 'start'], {
    cwd: root,
    stdio: 'inherit',
    timeout: 90_000,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} else {
  const entry = path.join(root, 'dist', 'index.js');
  process.chdir(root);
  process.argv = [process.execPath, entry, ...args];
  await import(pathToFileURL(entry).href);
}
