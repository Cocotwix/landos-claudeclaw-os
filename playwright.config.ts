import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './scripts/acceptance/specs',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  forbidOnly: true,
  outputDir: process.env.LANDOS_ACCEPTANCE_PLAYWRIGHT_OUTPUT_DIR
    ?? join(tmpdir(), 'landos-playwright-test-output'),
  reporter: [['line']],
  use: {
    ...devices['Desktop Chrome'],
    browserName: 'chromium',
    headless: process.env.LANDOS_ACCEPTANCE_HEADED !== '1',
    viewport: { width: 1440, height: 1000 },
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    acceptDownloads: false,
    serviceWorkers: 'block',
    // The acceptance spec owns these captures so it can enforce the exact
    // package names and close the manually-created isolated context before the
    // gate reads lifecycle evidence. Runner-level duplicates would start a
    // second trace/video lifecycle and leave unrelated artifacts behind.
    screenshot: 'off',
    trace: 'off',
    video: 'off',
  },
});
