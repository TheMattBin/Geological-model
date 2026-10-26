import { defineConfig } from '@playwright/test';
import { browserOptions, previewServer, reporters } from './tests/playwright.shared.mjs';

const { launchOptions, ...sharedOptions } = browserOptions;

export default defineConfig({
  testDir: './tests/compatibility',
  workers: 1,
  forbidOnly: !!process.env.CI,
  timeout: 60000,
  expect: { timeout: 15000 },
  outputDir: 'test-results/compatibility',
  reporter: reporters('compatibility'),
  use: { ...sharedOptions, baseURL: previewServer.url },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium', launchOptions } },
    {
      name: 'firefox',
      use: { browserName: 'firefox', launchOptions: { firefoxUserPrefs: { 'webgl.force-enabled': true } } }
    },
    { name: 'webkit', use: { browserName: 'webkit' } }
  ],
  webServer: previewServer
});
