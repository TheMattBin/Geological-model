import { defineConfig } from '@playwright/test';
import { browserOptions, reporters } from './tests/playwright.shared.mjs';

export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  forbidOnly: !!process.env.CI,
  outputDir: 'test-results/renderer',
  reporter: reporters('renderer'),
  use: {
    ...browserOptions,
    baseURL: 'http://127.0.0.1:3000'
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --open false --strictPort',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI
  }
});
