import { expect, test } from 'vitest';
import { frontageLabel } from './road-frontage.mjs';

test('road frontage renders in feet with a thousands separator', () => {
  expect(frontageLabel(1320)).toBe('1,320 ft');
  expect(frontageLabel(80)).toBe('80 ft');
});

test('unknown frontage is stated as unknown, never as zero feet', () => {
  expect(frontageLabel(null)).toBe('Unknown');
  expect(frontageLabel(0)).toBe('Unknown');
});
