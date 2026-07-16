import { describe, it, expect } from 'vitest';
import { formatRelativeTime } from './format.js';

describe('formatRelativeTime — never emits NaN', () => {
  const nowSec = Math.floor(Date.now() / 1000);

  it('formats unix seconds', () => {
    expect(formatRelativeTime(nowSec - 5)).toMatch(/s ago$/);
    expect(formatRelativeTime(nowSec - 3700)).toMatch(/h ago$/);
  });

  it('accepts an ISO string (the Activity-tab regression that showed "NaNy ago")', () => {
    const iso = new Date((nowSec - 120) * 1000).toISOString();
    expect(formatRelativeTime(iso)).toMatch(/m ago$/);
    expect(formatRelativeTime(iso)).not.toMatch(/NaN/);
  });

  it('accepts unix milliseconds', () => {
    expect(formatRelativeTime(Date.now() - 5000)).toMatch(/s ago$/);
  });

  it('returns "—" for invalid input instead of "NaN… ago"', () => {
    for (const bad of [NaN, undefined, null, '', 'not-a-date']) {
      const out = formatRelativeTime(bad as never);
      expect(out).not.toMatch(/NaN/);
      expect(out).toBe('—');
    }
  });
});
