import { defineConfig } from '@playwright/test';
import { browserOptions, previewServer, reporters } from './tests/playwright.shared.mjs';

export default defineConfig({
  testDir: './tests/visual',
  workers: 1,
  forbidOnly: !!process.env.CI,
  outputDir: 'test-results/visual',
  reporter: reporters('visual'),
  // Committed Linux/Chromium/SwiftShader baselines; CI never accepts new images automatically.
  snapshotPathTemplate: '{testDir}/baselines/{arg}{ext}',
  updateSnapshots: 'none',
  expect: {
    toHaveScreenshot: { animations: 'disabled', maxDiffPixelRatio: 0.002, threshold: 0.15 }
  },
  use: { ...browserOptions, baseURL: previewServer.url },
  webServer: previewServer
});
