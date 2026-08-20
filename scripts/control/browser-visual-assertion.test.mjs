// Browser visual acceptance must prove the OUTCOME, not the paperwork.
//
// The gate previously proved that an evidence record existed with the right
// labels. A builder could therefore record "surface=… expected=… refresh=PASS
// console=clean reruns=none screenshot=proof.png" and pass without the record
// ever stating what was actually on screen. These tests hold the hardened
// contract: a concrete visible_assertion= is mandatory, refresh= must restate a
// concrete outcome, and the named generic claims are refused outright.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BROWSER_VISUAL_ACCEPTANCE_FIELDS,
  BROWSER_VISUAL_ACCEPTANCE_CONCRETE_FIELDS,
  browserVisualAcceptanceEvidenceRefusals,
  genericVisualEvidenceReason,
  readAcceptanceField,
} from './verification-plan.mjs';

const CONCRETE = 'Brush Creek Rd; 40.2 ac; $900,000; Core/Accepted comp card visible';
const good = (over = {}) => {
  const fields = {
    surface: 'http://localhost:3141/dept/acquisitions/v2?deal=89 — Valuation & comps',
    expected: 'actual named comparable property cards render',
    visible_assertion: CONCRETE,
    refresh: `after hard refresh the same card still reads ${CONCRETE}`,
    console: 'no new errors',
    reruns: 'none; GET-only',
    screenshot: 'store/qa/proof.png',
    ...over,
  };
  return BROWSER_VISUAL_ACCEPTANCE_FIELDS.map((f) => `${f}=${fields[f]}`).join('; ');
};

test('visible_assertion is a required field of the permanent gate', () => {
  assert.ok(BROWSER_VISUAL_ACCEPTANCE_FIELDS.includes('visible_assertion'));
  assert.deepEqual([...BROWSER_VISUAL_ACCEPTANCE_CONCRETE_FIELDS], ['visible_assertion', 'refresh']);
});

test('a concrete, fully labeled record passes', () => {
  assert.deepEqual(browserVisualAcceptanceEvidenceRefusals(good()), []);
});

test('a record without visible_assertion is refused', () => {
  const withoutAssertion = BROWSER_VISUAL_ACCEPTANCE_FIELDS
    .filter((f) => f !== 'visible_assertion')
    .map((f) => `${f}=${f === 'surface' ? 'http://localhost:3141/x' : 'something'}`).join('; ');
  const refusals = browserVisualAcceptanceEvidenceRefusals(withoutAssertion);
  assert.ok(refusals.some((r) => /visible_assertion=/.test(r)), refusals.join(' | '));
});

test('refresh proof is mandatory and must restate a concrete outcome', () => {
  assert.ok(browserVisualAcceptanceEvidenceRefusals(good({ refresh: 'PASS' }))
    .some((r) => /^refresh= /.test(r)));
  assert.ok(browserVisualAcceptanceEvidenceRefusals(good({ refresh: 'page loaded' }))
    .some((r) => /^refresh= /.test(r)));
  const missingRefresh = BROWSER_VISUAL_ACCEPTANCE_FIELDS
    .filter((f) => f !== 'refresh')
    .map((f) => `${f}=${f === 'surface' ? 'http://localhost:3141/x' : CONCRETE}`).join('; ');
  assert.ok(browserVisualAcceptanceEvidenceRefusals(missingRefresh).some((r) => /refresh=/.test(r)));
});

test('every named generic claim is refused as a visible assertion', () => {
  const generic = [
    'page loaded', 'HTTP 200', '200', 'UI visible', 'the page is rendered',
    'feature works', 'works as expected', '97 records returned', '43 rows found',
    'database rows exist', 'screenshot captured', 'verified', 'no console errors',
    'tests pass', 'API response ok',
  ];
  for (const claim of generic) {
    assert.ok(
      genericVisualEvidenceReason(claim),
      `"${claim}" must be refused as a visible assertion`,
    );
    assert.ok(
      browserVisualAcceptanceEvidenceRefusals(good({ visible_assertion: claim }))
        .some((r) => /^visible_assertion= /.test(r)),
      `"${claim}" must refuse the whole record`,
    );
  }
});

test('a claim with no on-screen value is refused even when it is not on the generic list', () => {
  assert.ok(genericVisualEvidenceReason('everything looked correct to me'));
  assert.equal(genericVisualEvidenceReason('Quick Flip badge visibly reads PASS on Deal Card 89'), null);
  assert.equal(genericVisualEvidenceReason('Current zoning card visibly reads RS-15'), null);
  assert.equal(genericVisualEvidenceReason(CONCRETE), null);
});

test('backend-only evidence can never satisfy the gate', () => {
  for (const backendOnly of [
    'HTTP 200 and database rows persisted',
    'the API returned 97 comps and the rows exist in landos_comp',
    'all targeted tests pass and the production build is clean',
  ]) {
    assert.ok(browserVisualAcceptanceEvidenceRefusals(backendOnly).length > 0);
  }
});

test('the operator application origin is still required', () => {
  const offOrigin = good({ surface: 'http://localhost:9999/dept/acquisitions/v2?deal=89' });
  assert.ok(browserVisualAcceptanceEvidenceRefusals(offOrigin).some((r) => /localhost:3141/.test(r)));
});

test('field values are read up to end of line, not just presence-checked', () => {
  assert.equal(readAcceptanceField('surface=http://localhost:3141/x\nexpected=y', 'surface'), 'http://localhost:3141/x');
  assert.equal(readAcceptanceField('nothing here', 'surface'), null);
  assert.equal(readAcceptanceField('visible_assertion=   ', 'visible_assertion'), null);
});
