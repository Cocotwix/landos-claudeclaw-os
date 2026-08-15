import { expect, test } from 'vitest';
import { roundAcres } from './acre-round.mjs';

test('acreage renders at two decimals and drops trailing zeros', () => {
  expect(roundAcres(60)).toBe('60');
  expect(roundAcres(60.0)).toBe('60');
  expect(roundAcres(60.004)).toBe('60');
  expect(roundAcres(59.996)).toBe('60');
  expect(roundAcres(12.5)).toBe('12.5');
  expect(roundAcres(12.345)).toBe('12.35');
});

test('agreement between sources is not a disagreement', () => {
  expect(roundAcres(60)).toBe(roundAcres(60.0));
  expect(roundAcres(60)).toBe(roundAcres(60.004));
});
