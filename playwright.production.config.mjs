import { defineConfig } from '@playwright/test';
import { browserOptions, previewServer, reporters } from './tests/playwright.shared.mjs';

const remoteURL = process.env.PLAYWRIGHT_BASE_URL;
export default defineConfig({
  testDir: './tests/production',
  workers: 1,
  forbidOnly: !!process.env.CI,
  timeout: 60000,
  outputDir: 'test-results/production',
  reporter: reporters('production'),
  use: {
    ...browserOptions,
    baseURL: remoteURL ? `${remoteURL.replace(/\/$/, '')}/` : previewServer.url
  },
  webServer: remoteURL ? undefined : previewServer
});
