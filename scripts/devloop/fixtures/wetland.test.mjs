import { expect, test } from 'vitest';
import { wetlandLabel } from './wetland.mjs';
test('wetland coverage renders as a percentage', () => {
  expect(wetlandLabel(0)).toBe('None mapped');
  expect(wetlandLabel(0.125)).toBe('13% wetland');
});
test('unmapped wetland is not zero', () => {
  expect(wetlandLabel(null)).toBe('Not mapped');
});
