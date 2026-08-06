// Listing history and honest market time.
//
// The defect under test: LandOS printed whatever "days on market" the provider
// supplied. That figure counts only the CURRENT listing episode, so a seller who
// withdraws a stale listing for a week and relists it resets it to zero and a
// tired parcel reads as fresh. These tests pin both figures apart and pin the
// evidence gate on stitching.

import { describe, expect, it } from 'vitest';

import {
  computeCompMarketTime, splitListingEpisodes, daysBetween, sortListingEvents,
  type CompListingEvent,
} from './comp-listing-history.js';

const ev = (dateIso: string, kind: CompListingEvent['kind'], price: number | null = null): CompListingEvent =>
  ({ dateIso, kind, price, label: kind, source: 'Zillow listing history' });

describe('exact calendar date math', () => {
  it('counts real days, never 30.44-day months', () => {
    expect(daysBetween('2025-01-01', '2025-03-01')).toBe(59); // Jan 31 + Feb 28
    expect(daysBetween('2024-01-01', '2024-03-01')).toBe(60); // leap year
    expect(daysBetween('2025-11-18', '2025-11-18')).toBe(0);
  });

  it('returns null rather than guessing when a date is unusable', () => {
    expect(daysBetween('November 2025', '2025-12-01')).toBeNull();
    expect(daysBetween(null, '2025-12-01')).toBeNull();
  });

  it('sorts events by exact date and drops undated ones from the math', () => {
    const sorted = sortListingEvents([ev('2025-06-01', 'sold'), ev('2025-01-01', 'listed'), ev('nope' as string, 'listed')]);
    expect(sorted.map((e) => e.dateIso)).toEqual(['2025-01-01', '2025-06-01']);
  });
});

describe('episode splitting', () => {
  it('opens on listed/relisted and closes on withdrawn/sold', () => {
    const episodes = splitListingEpisodes([
      ev('2025-01-10', 'listed', 60000),
      ev('2025-03-01', 'price_change', 55000),
      ev('2025-04-01', 'withdrawn'),
      ev('2025-04-20', 'relisted', 52000),
      ev('2025-08-01', 'sold', 49000),
    ], '2026-08-06');
    expect(episodes).toHaveLength(2);
    expect(episodes[0].startIso).toBe('2025-01-10');
    expect(episodes[0].endKind).toBe('withdrawn');
    expect(episodes[1].startIso).toBe('2025-04-20');
    expect(episodes[1].endKind).toBe('sold');
  });

  it('keeps pending and back-on-market INSIDE an episode', () => {
    // A pending contract is not an off-market withdrawal. Treating it as one
    // would invent a relist the source never documented.
    const episodes = splitListingEpisodes([
      ev('2025-01-10', 'listed'),
      ev('2025-05-01', 'pending'),
      ev('2025-05-20', 'back_on_market'),
      ev('2025-09-01', 'sold'),
    ], '2026-08-06');
    expect(episodes).toHaveLength(1);
    expect(episodes[0].events).toHaveLength(4);
  });
});

describe('sold comparable cumulative days on market', () => {
  it('runs from the earliest listing in the cycle to the verified sold date', () => {
    const r = computeCompMarketTime({
      events: [ev('2025-01-10', 'listed', 60000), ev('2025-08-01', 'sold', 49000)],
      transactionKind: 'closed',
      soldDateIso: '2025-08-01',
      todayIso: '2026-08-06',
    });
    expect(r.originalListingDateIso).toBe('2025-01-10');
    expect(r.originalListPrice).toBe(60000);
    expect(r.cumulativeDays).toBe(203);
    expect(r.episodeCount).toBe(1);
  });

  it('stitches a short withdrawal and reports both DOM figures separately', () => {
    const r = computeCompMarketTime({
      events: [
        ev('2025-04-01', 'listed', 60000),
        ev('2025-07-15', 'withdrawn'),
        ev('2025-07-22', 'relisted', 55000),
        ev('2025-07-27', 'sold', 54000),
      ],
      transactionKind: 'closed',
      soldDateIso: '2025-07-27',
      todayIso: '2026-08-06',
      providerDaysOnMarket: 5,
    });
    expect(r.relistStitched).toBe(true);
    expect(r.stitchedGaps).toEqual([{ fromIso: '2025-07-15', toIso: '2025-07-22', days: 7 }]);
    expect(r.originalListingDateIso).toBe('2025-04-01');
    expect(r.cumulativeDays).toBe(117);
    // The provider figure is preserved untouched, never "corrected".
    expect(r.providerDaysOnMarket).toBe(5);
    expect(r.currentEpisodeDays).toBe(5);
    expect(r.withdrawnDays).toBe(7);
    expect(r.marketedDays).toBe(110);
    expect(r.lines.join(' ')).toContain('Provider DOM: 5 days');
    expect(r.lines.join(' ')).toContain('LandOS cumulative DOM: 117 days');
    expect(r.lines.join(' ')).toMatch(/withdrawn and relisted without an intervening sale/i);
  });

  it('refuses to stitch across a gap longer than thirty days', () => {
    const r = computeCompMarketTime({
      events: [
        ev('2024-01-01', 'listed', 90000),
        ev('2024-03-01', 'withdrawn'),
        ev('2025-04-01', 'relisted', 60000),
        ev('2025-08-01', 'sold', 55000),
      ],
      transactionKind: 'closed',
      soldDateIso: '2025-08-01',
      todayIso: '2026-08-06',
    });
    expect(r.relistStitched).toBe(false);
    expect(r.episodeCount).toBe(1);
    expect(r.originalListingDateIso).toBe('2025-04-01');
  });

  it('refuses to stitch when an intervening sale, ownership or acreage change is documented', () => {
    const events = [
      ev('2025-01-01', 'listed', 90000),
      ev('2025-02-01', 'withdrawn'),
      ev('2025-02-10', 'relisted', 60000),
      ev('2025-06-01', 'sold', 55000),
    ];
    for (const evidence of [{ interveningSale: true }, { ownershipChanged: true }, { acreageChanged: true }, { majorImprovement: true }]) {
      const r = computeCompMarketTime({
        events, transactionKind: 'closed', soldDateIso: '2025-06-01',
        todayIso: '2026-08-06', relistEvidence: evidence,
      });
      expect(r.relistStitched).toBe(false);
      expect(r.originalListingDateIso).toBe('2025-02-10');
    }
  });

  it('says "Relist stitching uncertain" instead of silently merging', () => {
    const r = computeCompMarketTime({
      events: [
        ev('2025-01-01', 'listed', 90000),
        ev('2025-02-01', 'withdrawn'),
        ev('2025-02-10', 'relisted', 60000),
        ev('2025-06-01', 'sold', 55000),
      ],
      transactionKind: 'closed',
      soldDateIso: '2025-06-01',
      todayIso: '2026-08-06',
      relistEvidence: { uncertain: true },
    });
    expect(r.stitchUncertain).toBe(true);
    expect(r.relistStitched).toBe(false);
    expect(r.lines.join(' ')).toContain('Relist stitching uncertain');
  });

  it('collects documented price reductions', () => {
    const r = computeCompMarketTime({
      events: [
        ev('2025-01-01', 'listed', 60000),
        ev('2025-03-01', 'price_change', 55000),
        ev('2025-05-01', 'price_change', 49900),
        ev('2025-06-01', 'sold', 48000),
      ],
      transactionKind: 'closed', soldDateIso: '2025-06-01', todayIso: '2026-08-06',
    });
    expect(r.priceReductions).toEqual([
      { dateIso: '2025-03-01', from: 60000, to: 55000, drop: 5000 },
      { dateIso: '2025-05-01', from: 55000, to: 49900, drop: 5100 },
    ]);
  });
});

describe('active listing cumulative market days', () => {
  it('runs the clock through today and flags a cosmetic refresh', () => {
    const r = computeCompMarketTime({
      events: [
        ev('2025-06-17', 'listed', 209000),
        ev('2026-07-10', 'withdrawn'),
        ev('2026-07-17', 'relisted', 209000),
      ],
      transactionKind: 'active',
      todayIso: '2026-08-06',
      providerDaysOnMarket: 20,
    });
    expect(r.originalListingDateIso).toBe('2025-06-17');
    expect(r.cumulativeDays).toBe(daysBetween('2025-06-17', '2026-08-06'));
    expect(r.providerDaysOnMarket).toBe(20);
    expect(r.currentEpisodeDays).toBe(20);
    expect(r.freshness).toBe('cosmetically_refreshed');
    expect(r.relistStitched).toBe(true);
  });

  it('calls a single short episode genuinely new and a long one long-running', () => {
    const fresh = computeCompMarketTime({
      events: [ev('2026-07-17', 'listed', 79900)], transactionKind: 'active', todayIso: '2026-08-06',
    });
    expect(fresh.freshness).toBe('genuinely_new');
    expect(fresh.cumulativeDays).toBe(20);

    const stale = computeCompMarketTime({
      events: [ev('2025-06-17', 'listed', 209000)], transactionKind: 'active', todayIso: '2026-08-06',
    });
    expect(stale.freshness).toBe('long_running');
    expect(stale.cumulativeDays).toBe(415);
  });
});

describe('missing history is stated, never guessed', () => {
  it('reports cumulative DOM unavailable when only the current episode is exposed', () => {
    const r = computeCompMarketTime({
      events: [], transactionKind: 'active', todayIso: '2026-08-06', providerDaysOnMarket: 12,
    });
    expect(r.cumulativeDays).toBeNull();
    expect(r.completeness).toBe('current_episode_only');
    expect(r.lines[0]).toContain('Cumulative DOM unavailable');
    expect(r.lines[0]).toContain('only the current listing episode');
  });

  it('reports no history at all without inventing a listing date', () => {
    const r = computeCompMarketTime({ events: [], transactionKind: 'closed', soldDateIso: '2025-06-01', todayIso: '2026-08-06' });
    expect(r.originalListingDateIso).toBeNull();
    expect(r.cumulativeDays).toBeNull();
    expect(r.completeness).toBe('none');
  });
});
