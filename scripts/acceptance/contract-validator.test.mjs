import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  evaluateComparison,
  validateAcceptanceContract,
  validateAcceptanceResults,
} from './contract-validator.mjs';
import { buildRunContract, resolveExpectedBinding } from './contract-builder.mjs';
import { buildPassingPackage, readResults } from './test-support.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const ROOT = resolve('.');
const CONTRACT = join(ROOT, 'config', 'acceptance', '704-bell-known-defect.contract.json');

test('published schemas and the 704 contract are valid JSON with a versioned shared boundary', async () => {
  for (const name of ['acceptance-contract.schema.json', 'results.schema.json', '704-bell-known-defect.contract.json']) {
    const value = JSON.parse(await readFile(join(ROOT, 'config', 'acceptance', name), 'utf8'));
    assert.equal(typeof value, 'object');
  }
  const contract = JSON.parse(await readFile(CONTRACT, 'utf8'));
  assert.deepEqual(validateAcceptanceContract(contract), []);
  assert.equal(contract.schemaVersion, '1.0.0');
  assert.equal(contract.independentAuthority, 'landos-visual-qa');
});

test('contract validation rejects missing predeclared evidence and non-independent authority', async () => {
  const contract = JSON.parse(await readFile(CONTRACT, 'utf8'));
  contract.independentAuthority = 'implementation-role';
  contract.claims[0].evidenceArtifacts = [];
  const errors = validateAcceptanceContract(contract);
  assert.ok(errors.some((error) => error.includes('independent acceptance')));
  assert.ok(errors.some((error) => error.includes('evidenceArtifacts')));
});

test('fresh-address contract construction atomically rebinds identity and every semantic expectation', async () => {
  const template = JSON.parse(await readFile(CONTRACT, 'utf8'));
  const contract = buildRunContract(template, {
    mode: 'live',
    startedAt: '2026-08-03T02:00:00.000Z',
    environment: {
      LANDOS_ACCEPTANCE_ENTRY_FLOW: 'new-lead',
      LANDOS_ACCEPTANCE_PROPERTY_ADDRESS: '18 Orchard Ln, Auburn, NY 13021',
      LANDOS_ACCEPTANCE_NORMALIZED_ADDRESS: '18 Orchard Ln, Auburn, NY 13021',
      LANDOS_ACCEPTANCE_PROPERTY_APN: '123.45-6-7',
      LANDOS_ACCEPTANCE_PROPERTY_ID: 'property-1800',
      LANDOS_ACCEPTANCE_CANONICAL_COMPS: '6',
      LANDOS_ACCEPTANCE_CANONICAL_VISUALS: '3',
      LANDOS_ACCEPTANCE_FRESHNESS_REQUIRED: '1',
    },
  });
  assert.deepEqual(validateAcceptanceContract(contract), []);
  assert.equal(contract.property.apn, '123.45-6-7');
  assert.equal(contract.property.canonicalPropertyId, 'property-1800');
  assert.equal(contract.property.canonicalCounts.comps, 6);
  assert.equal(contract.property.canonicalCounts.visuals, 3);
  for (const claim of contract.claims) assert.equal(claim.expectedValue, resolveExpectedBinding(contract, claim.expectedBinding));
  const serialized = JSON.stringify(contract);
  assert.doesNotMatch(serialized, /704 Bell|056400 37\.00-1-33|89520173/);
});

test('a changed subject cannot inherit the template APN or property identifier', async () => {
  const template = JSON.parse(await readFile(CONTRACT, 'utf8'));
  assert.throws(() => buildRunContract(template, {
    mode: 'live',
    startedAt: '2026-08-03T02:00:00.000Z',
    environment: { LANDOS_ACCEPTANCE_PROPERTY_ADDRESS: '18 Orchard Ln, Auburn, NY 13021' },
  }), /LANDOS_ACCEPTANCE_PROPERTY_APN is required/);
});

test('results validator accepts a complete generated result and rejects a claim without lifecycle outcomes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'landos-results-schema-'));
  try {
    await buildPassingPackage(root, CONTRACT);
    const results = await readResults(root);
    assert.deepEqual(validateAcceptanceResults(results), []);
    delete results.claims[0].restartResult;
    assert.ok(validateAcceptanceResults(results).some((error) => error.includes('restartResult')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('comparison evaluation is deterministic for every contract comparison kind', () => {
  assert.equal(evaluateComparison('equals', true, true), true);
  assert.equal(evaluateComparison('count_equals', 4, 0), false);
  assert.equal(evaluateComparison('contains', 'Bell Rd', '704 Bell Rd, Red Creek'), true);
  assert.equal(evaluateComparison('present', true, 'visible'), true);
  assert.equal(evaluateComparison('absent', false, ''), true);
  assert.equal(evaluateComparison('no_contamination', true, true), true);
});
