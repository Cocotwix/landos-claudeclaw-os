import { expect, test } from 'vitest';
import { normalizeApn } from './parcel-id.mjs';

test('APN normalization strips punctuation and case', () => {
  expect(normalizeApn('05-013-021-00')).toBe('0501302100');
  expect(normalizeApn('05 013 021 00')).toBe('0501302100');
  expect(normalizeApn('  05.013.021.00 ')).toBe('0501302100');
});

test('an unusable APN normalizes to null, never to an empty string', () => {
  expect(normalizeApn('')).toBe(null);
  expect(normalizeApn(null)).toBe(null);
  expect(normalizeApn('---')).toBe(null);
});
