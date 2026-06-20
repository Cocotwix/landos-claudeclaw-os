import { describe, it, expect } from 'vitest';
import {
  captureImagery,
  makeStubImageryCapturer,
  IMAGERY_SUPPORTING_CONTEXT_LABEL,
  IMAGERY_NOT_CAPTURED_NOTE,
  type ImageryCapturer,
  type CapturedImagery,
} from './imagery-capture.js';

describe('captureImagery', () => {
  it('returns not-captured cleanly with stubs and labels supporting-context only', async () => {
    const res = await captureImagery({ address: '1 A St' });
    expect(res.notCaptured).toBe(true);
    expect(res.label).toBe(IMAGERY_SUPPORTING_CONTEXT_LABEL);
    expect(res.description.text).toBe(IMAGERY_NOT_CAPTURED_NOTE);
    expect(res.note).toMatch(/never verifies parcel identity/i);
    expect(res.captures.every((c) => c.status === 'not_connected')).toBe(true);
  });

  it('describes a captured image as supporting context, never as identity', async () => {
    const live: ImageryCapturer = {
      id: 'google_earth', label: 'GE',
      async capture(): Promise<CapturedImagery> {
        return { sourceId: 'google_earth', status: 'captured', imagePath: '/tmp/x.png', label: IMAGERY_SUPPORTING_CONTEXT_LABEL, note: 'ok' };
      },
    };
    const res = await captureImagery({ address: '1 A St' }, { capturers: [live] });
    expect(res.notCaptured).toBe(false);
    expect(res.description.label).toBe(IMAGERY_SUPPORTING_CONTEXT_LABEL);
    // Stub describer is not connected: no invented description.
    expect(res.description.available).toBe(false);
  });

  it('honors the overall budget cap (later sources skipped)', async () => {
    let t = 0;
    const res = await captureImagery(
      { address: '1 A St' },
      { capturers: [makeStubImageryCapturer('google_earth', 'GE'), makeStubImageryCapturer('zillow_photo', 'Z')], overallBudgetMs: 10, now: () => (t += 100) },
    );
    expect(res.captures.some((c) => c.status === 'skipped')).toBe(true);
  });
});
