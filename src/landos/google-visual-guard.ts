// LandOS — Google visual usage guard (LIGHT, manual-control bookkeeping).
//
// Google has a monthly free tier; this is a usage LOG to keep visual capture
// explicit and auditable (no runaway loops, no bulk generation). It makes NO
// network call and is NEVER invoked by tests, dashboard startup, or hidden
// workflows — only by an explicit per-property capture. Counter lives only in a
// local, gitignored runtime file (store/ is gitignored). Never records the key.

import fs from 'fs';
import path from 'path';
import { landosArtifactPath } from './storage-profile.js';

export interface VisualCaptureRecord {
  timestamp: string;
  property: string;       // address/identifier label — never a secret
  service: string;        // e.g. 'maps_static'
  success: boolean;
}

export interface VisualUsageState {
  capturesMade: number;
  records: VisualCaptureRecord[];
}

function defaultFile(): string {
  return landosArtifactPath('google-visual-usage.json');
}

export function loadVisualUsage(file: string = defaultFile()): VisualUsageState {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf-8')) as VisualUsageState;
    return { capturesMade: typeof s.capturesMade === 'number' ? s.capturesMade : 0, records: Array.isArray(s.records) ? s.records : [] };
  } catch {
    return { capturesMade: 0, records: [] };
  }
}

/** Record one capture (after it runs). Never stores the key or image bytes. */
export function recordVisualCapture(
  opts: { property: string; service: string; success: boolean; now?: () => string },
  file: string = defaultFile(),
): VisualUsageState {
  const state = loadVisualUsage(file);
  state.capturesMade += 1;
  state.records.push({
    timestamp: (opts.now ?? (() => new Date().toISOString()))(),
    property: opts.property,
    service: opts.service,
    success: opts.success,
  });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
  return state;
}
