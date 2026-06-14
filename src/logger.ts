import path from 'path';
import fs from 'fs';
import pino from 'pino';

const LOG_DIR = path.resolve(process.cwd(), 'logs');
export const LOG_FILE = path.join(LOG_DIR, 'main.log');
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch { /* ignore */ }

const level = process.env.LOG_LEVEL || 'info';
const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level,
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
