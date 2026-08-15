import { expect, test } from 'vitest';
import { formatSaleDate } from './deed-date.mjs';

test('a sale date renders as YYYY-MM', () => {
  expect(formatSaleDate('2024-03-17T00:00:00.000Z')).toBe('2024-03');
  expect(formatSaleDate('2024-11-01')).toBe('2024-11');
});

test('an absent or unparseable sale date is null, never today', () => {
  expect(formatSaleDate(null)).toBe(null);
  expect(formatSaleDate('not a date')).toBe(null);
});
