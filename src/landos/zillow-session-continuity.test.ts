// One persistent Zillow session across the sold, active and manufactured boards.
//
// The defect this pins: `withSharedZillowSession` reference-counts and closes on
// the last release, so two lanes that merely happened not to overlap in time
// each opened their OWN session. The sold and active boards shared one identity
// and the manufactured board ran on a second — cookies, and any verification the
// operator had cleared, did not carry across. A lease held for the whole
// marketplace phase makes it one continuous session.

import { describe, expect, it, beforeEach } from 'vitest';

import { leaseSharedZillowSession, withSharedZillowSession } from './zillow-land-comps.js';

interface FakeSession { id: number; pages: string[]; closed: boolean; newPage: () => Promise<unknown>; close: () => Promise<void> }

let opened: FakeSession[] = [];
const open = async (): Promise<FakeSession> => {
  const session: FakeSession = {
    id: opened.length + 1,
    pages: [],
    closed: false,
    newPage: async () => ({}),
    close: async () => { session.closed = true; },
  };
  opened.push(session);
  return session;
};

const board = (session: FakeSession | null, name: string) => {
  (session as FakeSession).pages.push(name);
  return Promise.resolve(name);
};

beforeEach(() => { opened = []; });

describe('the three Zillow boards run on one persistent session', () => {
  it('opens one session for sold, active and manufactured run sequentially under a lease', async () => {
    const lease = leaseSharedZillowSession({ open: open as never });
    // Sequential, exactly as the lanes run them.
    await withSharedZillowSession((s) => board(s as FakeSession, 'sold'), { open: open as never });
    await withSharedZillowSession((s) => board(s as FakeSession, 'active'), { open: open as never });
    await withSharedZillowSession((s) => board(s as FakeSession, 'manufactured'), { open: open as never });
    expect(opened).toHaveLength(1);
    expect(opened[0].pages).toEqual(['sold', 'active', 'manufactured']);
    expect(opened[0].closed).toBe(false);

    await lease.release();
    expect(opened).toHaveLength(1);
    expect(opened[0].closed).toBe(true);
  });

  it('without a lease, sequential lanes each open their own session — the defect', async () => {
    await withSharedZillowSession((s) => board(s as FakeSession, 'sold'), { open: open as never });
    await withSharedZillowSession((s) => board(s as FakeSession, 'manufactured'), { open: open as never });
    expect(opened.length).toBeGreaterThan(1);
  });

  it('never leaves the session open after the lease is released', async () => {
    const lease = leaseSharedZillowSession({ open: open as never });
    await withSharedZillowSession((s) => board(s as FakeSession, 'sold'), { open: open as never });
    await lease.release();
    expect(opened.every((session) => session.closed)).toBe(true);
  });

  it('releases the lease even when a board throws', async () => {
    const lease = leaseSharedZillowSession({ open: open as never });
    await expect(withSharedZillowSession(async () => { throw new Error('board blocked'); }, { open: open as never }))
      .rejects.toThrow('board blocked');
    await lease.release();
    expect(opened.every((session) => session.closed)).toBe(true);
  });
});

describe('the manufactured lane is leased alongside the vacant-land lanes', () => {
  it('holds the lease whenever either lane will run', () => {
    // Source contract: the lease is taken when the vacant-land OR the
    // manufactured lane is going to run, and released only once every board in
    // the phase has settled.
    const src = require('node:fs').readFileSync('src/landos/property-intelligence-live.ts', 'utf8') as string;
    expect(src).toContain('leaseSharedZillowSession()');
    expect(src).toMatch(/zillowLease\?\.release\(\)/);
    expect(src.indexOf('const zillowLease')).toBeLessThan(src.indexOf('const zillowPromise'));
    expect(src.indexOf('zillowLease?.release()')).toBeGreaterThan(src.indexOf('manufacturedHomesPromise ??'));
  });
});
