// Fixture-only vitest config. The product config includes src/** and web/src/**
// only, so harness proof fixtures can never leak into the real suite.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', include: ['scripts/devloop/fixtures/**/*.test.mjs'] },
});
