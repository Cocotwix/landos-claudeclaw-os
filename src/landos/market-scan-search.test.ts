import { describe, it, expect } from 'vitest';
import { composeScanSearch, findingKey, hermesScanSearch, statedYear } from './market-scan-search.js';
import type { ScanFinding } from './market-scan.js';
import type { IdentitySearchProvider } from './hermes-free-search.js';

describe('statedYear', () => {
  it('takes the newest plausible stated year', () => {
    expect(statedYear('2026 land market report, updated from 2024')).toBe(2026);
  });

  it('ignores numbers that are not plausible publication years', () => {
    expect(statedYear('Parcel 20501 sold for 1999 dollars an acre')).toBeNull();
    expect(statedYear('no year here')).toBeNull();
  });
});

describe('findingKey', () => {
  it('treats the same page under different schemes, hosts and queries as one', () => {
    const a: ScanFinding = { title: 'A', summary: '', url: 'https://www.example.com/news/x/?utm=1' };
    const b: ScanFinding = { title: 'B', summary: '', url: 'http://example.com/news/x#top' };
    expect(findingKey(a)).toBe(findingKey(b));
  });

  it('falls back to the title when there is no usable URL', () => {
    expect(findingKey({ title: 'Land Report', summary: '', url: null })).toBe('title:land report');
  });
});

describe('hermesScanSearch', () => {
  it('adapts keyless hits into scan findings with a stated year', async () => {
    const provider: IdentitySearchProvider = async () => ([
      { title: 'County land prices 2026', url: 'https://a.example/1', snippet: 'Median rose.' },
      { title: '', url: 'https://b.example/2', snippet: '' },
    ]);
    const findings = await hermesScanSearch(provider)('anything');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ url: 'https://a.example/1', year: 2026 });
  });

  it('reports no findings rather than failing when the capability is dark', async () => {
    const provider: IdentitySearchProvider = async () => [];
    expect(await hermesScanSearch(provider)('anything')).toEqual([]);
  });
});

describe('composeScanSearch', () => {
  const finding = (url: string, title = url): ScanFinding => ({ title, summary: '', url });

  it('is null only when no transport exists at all', () => {
    expect(composeScanSearch([null, undefined])).toBeNull();
    expect(composeScanSearch([null, async () => []])).toBeTypeOf('function');
  });

  it('merges both transports and counts a shared story once', async () => {
    const merged = composeScanSearch([
      async () => [finding('https://a.example/one'), finding('https://shared.example/x')],
      async () => [finding('https://www.shared.example/x/'), finding('https://b.example/two')],
    ])!;
    const out = await merged('q');
    expect(out.map((f) => f.url)).toEqual([
      'https://a.example/one',
      'https://shared.example/x',
      'https://b.example/two',
    ]);
  });

  it('still answers when one transport fails', async () => {
    const merged = composeScanSearch([
      async () => { throw new Error('gemini quota'); },
      async () => [finding('https://keyless.example/one')],
    ])!;
    expect(await merged('q')).toHaveLength(1);
  });

  it('throws only when every transport failed', async () => {
    const merged = composeScanSearch([
      async () => { throw new Error('gemini quota'); },
      async () => { throw new Error('ddgs blocked'); },
    ])!;
    await expect(merged('q')).rejects.toThrow(/Every market-scan search transport failed/);
  });
});
