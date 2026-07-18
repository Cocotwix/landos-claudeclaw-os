import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const APP = fs.readFileSync(fileURLToPath(new URL('../../web/src/App.tsx', import.meta.url)), 'utf8');
const DOCK = fs.readFileSync(fileURLToPath(new URL('../../web/src/components/MaxDock.tsx', import.meta.url)), 'utf8');
const ROUTES = fs.readFileSync(fileURLToPath(new URL('../../web/src/lib/routes.ts', import.meta.url)), 'utf8');

describe('persistent Max chief-of-staff surface', () => {
  it('mounts once outside the route switch so it survives every navigation', () => {
    expect(APP).toContain('<MaxDock />');
    expect(APP.indexOf('<MaxDock />')).toBeGreaterThan(APP.indexOf('</main>'));
    expect(DOCK).toContain('data-testid="max-dock"');
  });

  it('supports immediate text, speech-to-text, send, and global stream replies', () => {
    expect(DOCK).toContain("apiPost<{ ok?: boolean; error?: string }>('/api/chat/send'");
    expect(DOCK).toContain('subscribeChatStream');
    expect(DOCK).toContain('SpeechRecognition');
    for (const hook of ['max-dock-input', 'max-dock-microphone', 'max-dock-send', 'max-dock-conversation']) expect(DOCK).toContain(`data-testid="${hook}"`);
  });

  it('uses Max in operator navigation while retaining compatibility paths internally', () => {
    expect(ROUTES).toContain("label: 'Max'");
    expect(ROUTES).not.toContain("label: 'Jarvis'");
  });
});
