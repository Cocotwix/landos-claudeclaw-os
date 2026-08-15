import { expect, test } from 'vitest';
import { utilityLabel } from './utility.mjs';
test('utility presence reads plainly', () => {
  expect(utilityLabel({ power: true, water: false })).toBe('Power');
  expect(utilityLabel({ power: true, water: true })).toBe('Power, Water');
  expect(utilityLabel({ power: false, water: false })).toBe('None at road');
});
test('absent utility evidence is not absence of utilities', () => {
  expect(utilityLabel(null)).toBe('Not researched');
});
