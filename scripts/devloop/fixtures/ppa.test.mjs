import { expect, test } from 'vitest';
import { pricePerAcre } from './ppa.mjs';

test('price per acre is null when either input is missing or zero', () => {
  expect(pricePerAcre(null, 10)).toBe(null);
  expect(pricePerAcre(100000, 0)).toBe(null);
  expect(pricePerAcre(100000, null)).toBe(null);
});

test('price per acre rounds to whole dollars', () => {
  expect(pricePerAcre(100000, 10)).toBe(10000);
  expect(pricePerAcre(100000, 3)).toBe(33333);
});
