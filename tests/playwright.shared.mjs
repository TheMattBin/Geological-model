export const browserOptions = {
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
  locale: 'en-US',
  timezoneId: 'UTC',
  colorScheme: 'dark',
  reducedMotion: 'reduce',
  launchOptions: {
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader']
  },
  screenshot: 'only-on-failure',
  trace: 'retain-on-failure'
};

export function reporters(suite) {
  return [['list'], ['html', { outputFolder: `playwright-report/${suite}`, open: 'never' }]];
}

export const previewServer = {
  // Exercise a project subpath, like GitHub Pages, without rebuilding the artifact.
  command: 'npm run preview -- --host 127.0.0.1 --port 4173 --strictPort --base /Geological-model/',
  url: 'http://127.0.0.1:4173/Geological-model/',
  reuseExistingServer: false
};
