import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:3000',
    viewport: { width: 1440, height: 1000 },
    launchOptions: {
      args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader']
    },
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --open false',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI
  }
});
