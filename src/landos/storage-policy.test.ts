// Tests for the LandOS storage policy contract. No DB/network/secrets.

import { describe, it, expect } from 'vitest';

import {
  STORAGE_CATEGORIES,
  STORAGE_POLICY,
  STORAGE_ADAPTER_DIRECTION,
  REPO_FORBIDDEN_CATEGORIES,
  getStoragePolicy,
  isAllowedInRepo,
  assertNoRepoBloat,
} from './storage-policy.js';

describe('LandOS storage policy', () => {
  it('covers every storage category exactly once', () => {
    expect(STORAGE_POLICY.length).toBe(STORAGE_CATEGORIES.length);
    const ids = new Set(STORAGE_POLICY.map((p) => p.category));
    for (const c of STORAGE_CATEGORIES) expect(ids.has(c)).toBe(true);
  });

  it('keeps large property/business artifacts out of the repo', () => {
    for (const c of ['property_reports', 'property_media', 'source_documents', 'voice_transcripts', 'market_datasets'] as const) {
      expect(isAllowedInRepo(c)).toBe(false);
      expect(getStoragePolicy(c).gitignored).toBe(true);
    }
    expect(() => assertNoRepoBloat()).not.toThrow();
  });

  it('only lightweight build memory is allowed in the repo', () => {
    expect(isAllowedInRepo('build_memory')).toBe(true);
    const allowed = STORAGE_POLICY.filter((p) => p.allowedInRepo).map((p) => p.category);
    expect(allowed).toEqual(['build_memory']);
    expect(REPO_FORBIDDEN_CATEGORIES).not.toContain('build_memory');
    expect(REPO_FORBIDDEN_CATEGORIES).toContain('property_media');
  });

  it('deal card records persist locally (gitignored), not in the repo', () => {
    const dc = getStoragePolicy('deal_card_records');
    expect(dc.allowedInRepo).toBe(false);
    expect(dc.gitignored).toBe(true);
    expect(dc.location).toBe('local_runtime_gitignored');
  });

  it('supports future external-storage adapters without leg rewrites', () => {
    expect(STORAGE_ADAPTER_DIRECTION.pluggable).toBe(true);
    expect(STORAGE_ADAPTER_DIRECTION.legsUseContractNotPaths).toBe(true);
    expect(STORAGE_ADAPTER_DIRECTION.supportedTargets).toContain('cloud_object_store');
    expect(STORAGE_ADAPTER_DIRECTION.supportedTargets).toContain('database');
    // Categories that should prefer an external adapter long-term.
    for (const c of ['property_reports', 'property_media', 'market_datasets'] as const) {
      expect(getStoragePolicy(c).prefersExternalAdapter).toBe(true);
    }
  });
});
