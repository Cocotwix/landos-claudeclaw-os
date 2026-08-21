import { describe, it, expect, afterEach } from 'vitest';
import {
  setDealWarRoomContextProvider,
  getDealWarRoomContext,
  boundContextText,
} from './war-room-deal-context.js';

afterEach(() => setDealWarRoomContextProvider(null));

describe('deal War Room context seam', () => {
  it('returns null when no provider is registered (generic deployments, tests)', () => {
    expect(getDealWarRoomContext(89)).toBeNull();
  });

  it('resolves per deal card id and never leaks another deal context', () => {
    setDealWarRoomContextProvider((dealCardId) =>
      dealCardId === 89
        ? { dealCardId: 89, dealLabel: 'Fairview, TN · Deal 89', contextText: 'DEAL: Fairview' }
        : null);
    expect(getDealWarRoomContext(89)?.dealLabel).toBe('Fairview, TN · Deal 89');
    // A different deal id must not receive deal 89's context.
    expect(getDealWarRoomContext(88)).toBeNull();
  });

  it('a throwing provider degrades to null instead of failing the turn', () => {
    setDealWarRoomContextProvider(() => { throw new Error('broken read'); });
    expect(getDealWarRoomContext(89)).toBeNull();
  });

  it('bounds oversized context with an explicit truncation note', () => {
    const bounded = boundContextText('x'.repeat(100_000));
    expect(bounded.length).toBeLessThan(50_000);
    expect(bounded.endsWith('[deal context truncated at bound]')).toBe(true);
    expect(boundContextText('short')).toBe('short');
  });
});
