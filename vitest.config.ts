import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // web/src lib tests are pure node-safe presentation-model tests; DOM-bound
    // component behavior is covered by the browser QA journeys instead.
    include: ['src/**/*.test.ts', 'web/src/**/*.test.ts'],
    // Runs before any test module loads. Lets contract tests set env vars
    // that config.ts reads at import time without leaking real config.
    setupFiles: ['src/test-env-setup.ts'],
  },
});
