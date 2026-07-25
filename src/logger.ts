import path from 'path';
import fs from 'fs';
import pino from 'pino';

import { redactValue } from './log-redact.js';

const LOG_DIR = path.resolve(process.cwd(), 'logs');
export const LOG_FILE = path.join(LOG_DIR, 'main.log');
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch { /* ignore */ }

const level = process.env.LOG_LEVEL || 'info';
const isDev = process.env.NODE_ENV !== 'production';

/**
 * The single chokepoint for secret redaction. Every log call — the merging
 * object, the message, and any interpolation args — passes through here before
 * it can reach either sink (stdout and logs/main.log). See log-redact.ts for
 * why this is not left to individual call sites.
 *
 * Cost is a handful of regex passes plus a literal scan per log line.
 * Redaction failures must never take the process down, so a throw here falls
 * back to logging the original args rather than losing the line entirely.
 *
 * Exported so the redaction contract can be tested against the exact function
 * pino calls, rather than against a re-declared copy of it.
 */
export const redactingLogMethod: NonNullable<pino.LoggerOptions['hooks']>['logMethod'] =
  function logMethod(args, method) {
    let safe: typeof args;
    try {
      safe = args.map((a) => redactValue(a)) as typeof args;
    } catch {
      safe = args;
    }
    return method.apply(this, safe);
  };

export const logger = pino({
  level,
  hooks: { logMethod: redactingLogMethod },
  transport: {
    targets: [
      // stdout: pretty in dev, raw JSON in production
      isDev
        ? { target: 'pino-pretty', options: { colorize: true }, level }
        : { target: 'pino/file', options: { destination: 1 }, level },
      // always write JSON to log file regardless of how the process was started
      { target: 'pino/file', options: { destination: LOG_FILE }, level },
    ],
  },
});
