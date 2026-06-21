import { describe, it, expect } from 'vitest';
import { generatePlacematPdf } from './placemat.js';

describe('placemat (deferred)', () => {
  it('returns a not-implemented result and never produces a file (no PDF dep this leg)', () => {
    const r = generatePlacematPdf({ comps: [] });
    expect(r.implemented).toBe(false);
    expect(r.filePath).toBeNull();
    expect(r.reason).toMatch(/deferred/i);
  });
});
