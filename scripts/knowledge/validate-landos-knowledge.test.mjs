import assert from 'node:assert/strict';
import test from 'node:test';

import {
  validateCapabilityRegistry,
  validateCapabilityConsistency,
  validateKnowledgeTree,
  validateRegistry,
  validateWatcherRegistry,
} from './validate-landos-knowledge.mjs';

test('repository knowledge tree passes governance validation', () => {
  const result = validateKnowledgeTree();
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.equal(result.registryCount, 11);
});

test('registry validation rejects canonical-data duplication and unsafe refs', () => {
  const errors = validateRegistry({
    schemaVersion: 1,
    registryId: 'bad',
    canonicalAuthority: 'LandOS',
    entries: [{
      id: 'entry', title: 'Entry', status: 'active', summary: 'bad fixture',
      canonicalRefs: ['../.env'], canonicalData: { acreage: 1 },
    }],
  });
  assert.ok(errors.some((error) => error.includes('unsafe canonical ref')));
  assert.ok(errors.some((error) => error.includes('environment files')));
  assert.ok(errors.some((error) => error.includes('duplicate canonical data')));
});

test('watcher governance rejects implicit activation or assignments', () => {
  const errors = validateWatcherRegistry({
    schemaVersion: 1,
    definitions: [{ id: 'unsafe', enabled: true, target: 'all counties', schedule: '* * * * *', delivery: 'somewhere' }],
  });
  assert.equal(errors.length, 4);
});

test('capability governance requires exactly one DuckDuckGo primary and blocks paid Parallel', () => {
  const errors = validateCapabilityRegistry({
    capabilities: [
      { id: 'searxng-search', category: 'free-search', selection: 'primary' },
      { id: 'parallel-cli', status: 'approved' },
      { id: 'watchers', status: 'active' },
    ],
  });
  assert.equal(errors.length, 3);
});

test('cross-artifact capability governance rejects runtime, ownership, and approval drift', () => {
  const capabilities = {
    capabilities: [
      { id: 'duckduckgo-search', status: 'approved-unprovisioned', runtimeState: 'missing', profiles: ['landos-automation'] },
      { id: 'grounded-citations', runtimeState: 'installed' },
      { id: 'scrapling', status: 'approved' },
      { id: 'domain-intel', status: 'blocked' },
      { id: 'osint-investigation', status: 'approved' },
    ],
  };
  const manifest = {
    freeSearch: { selected: 'searxng-search', status: 'not-selected' },
    profiles: {
      'landos-research': { skillAllowlist: [] },
      'landos-automation': { skillAllowlist: ['duckduckgo-search'] },
    },
    skills: { optionalApproved: [] },
    optionalEvaluations: [
      { id: 'duckduckgo-search', status: 'blocked' },
      { id: 'grounded-citations', status: 'approved' },
      { id: 'scrapling', status: 'approved' },
      { id: 'domain-intel', status: 'blocked' },
      { id: 'osint-investigation', status: 'approved' },
    ],
  };
  const errors = validateCapabilityConsistency(capabilities, manifest);
  assert.ok(errors.length >= 9, errors.join('\n'));
  assert.ok(errors.some((error) => error.includes('research-only')));
  assert.ok(errors.some((error) => error.includes('grounded-citations')));
});
