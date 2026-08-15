import { expect, test } from 'vitest';
import { slopeLabel } from './slope.mjs';
test('slope buckets read as operator language', () => {
  expect(slopeLabel(2)).toBe('Flat');
  expect(slopeLabel(9)).toBe('Rolling');
  expect(slopeLabel(20)).toBe('Steep');
});
test('unknown slope is unknown, never flat', () => {
  expect(slopeLabel(null)).toBe('Unknown');
});
