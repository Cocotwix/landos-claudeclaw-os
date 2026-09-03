import { describe, expect, it } from 'vitest';
import { routePersistedAfterRefresh } from './browser-qa.js';

// A Deal Card URL canonicalises to the workspace with ?deal=<id>. A hard
// refresh must bring back that same card; the QA gate used to compare only
// the pre-redirect path and reported a false failure on every card.
describe('hard refresh brings back the same Deal Card', () => {
  it('passes when the canonical location (path plus deal query) comes back after the reload', () => {
    const result = routePersistedAfterRefresh({ expectedPath: '/deal/115', before: '/dept/acquisitions/v2?deal=115', after: '/dept/acquisitions/v2?deal=115' });
    expect(result.ok).toBe(true);
    expect(result.detail).toMatch(/canonicalised to \/dept\/acquisitions\/v2\?deal=115/);
  });

  it('passes when the requested path itself is kept', () => {
    expect(routePersistedAfterRefresh({ expectedPath: '/dept/acquisitions/v2', before: '/dept/acquisitions/v2?deal=89', after: '/dept/acquisitions/v2?deal=89' }).ok).toBe(true);
  });

  it('fails when the reload lands on a different card or the pipeline list', () => {
    expect(routePersistedAfterRefresh({ expectedPath: '/deal/115', before: '/dept/acquisitions/v2?deal=115', after: '/dept/acquisitions/v2?deal=89' }).ok).toBe(false);
    expect(routePersistedAfterRefresh({ expectedPath: '/deal/115', before: '/dept/acquisitions/v2?deal=115', after: '/dept/acquisitions' }).ok).toBe(false);
  });

  it('ignores the QA token and run parameters the harness adds', () => {
    expect(routePersistedAfterRefresh({ expectedPath: '/deal/115', before: '/dept/acquisitions/v2?deal=115&qa_token=abc', after: '/dept/acquisitions/v2?deal=115' }).ok).toBe(true);
  });
});
