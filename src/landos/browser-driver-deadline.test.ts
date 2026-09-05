import { describe, expect, it } from 'vitest';

import { DRIVER_CALL_DEADLINE_GRACE_MS, boundedDriverCall, driverCallDeadlineMs } from './browser-session.js';

// The county-records and LandPortal workflows hand every driver call their
// remaining budget as `{ timeoutMs }`. A read that ignores it can park a
// request forever on a page that never settles; the bound is what turns that
// into the timeout the workflow already reports as a terminal outcome.
describe('driver call deadline', () => {
  it('reads the caller deadline from the trailing options and adds the settle grace', () => {
    expect(driverCallDeadlineMs(['https://example.test', { timeoutMs: 3_000 }])).toBe(3_000 + DRIVER_CALL_DEADLINE_GRACE_MS);
    expect(driverCallDeadlineMs([{ timeoutMs: 250 }])).toBe(250 + DRIVER_CALL_DEADLINE_GRACE_MS);
  });

  it('leaves a call with no deadline unbounded', () => {
    expect(driverCallDeadlineMs([])).toBeNull();
    expect(driverCallDeadlineMs(['query'])).toBeNull();
    expect(driverCallDeadlineMs([{ timeoutMs: 0 }])).toBeNull();
    expect(driverCallDeadlineMs([{ timeoutMs: Number.NaN }])).toBeNull();
  });

  it('settles a read that never resolves with a caller-deadline timeout', async () => {
    const never = new Promise<never>(() => { /* a page that never settles */ });
    await expect(boundedDriverCall(never, 20, 'county_records.readLinks')).rejects.toThrow(/readLinks timed out after 20 ms \(caller deadline\)/);
  });

  it('passes a read that settles in time straight through', async () => {
    await expect(boundedDriverCall(Promise.resolve(['a']), 1_000, 'x.readLinks')).resolves.toEqual(['a']);
  });
});
