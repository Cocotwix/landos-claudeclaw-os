import { describe, expect, it } from 'vitest';

import { liveProcessIds } from './platform.js';

describe('platform process health', () => {
  it('checks multiple PIDs without launching an OS command', () => {
    const ids = liveProcessIds([process.pid, process.pid, -1, Number.NaN]);
    expect(ids.has(process.pid)).toBe(true);
    expect(ids.size).toBe(1);
  });
});
