import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  outputDir: './artifacts/browser-results',
  reporter: [['list'], ['json', { outputFile: './artifacts/browser-results.json' }]],
  use: { baseURL: 'http://127.0.0.1:5181', screenshot: 'only-on-failure' },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  webServer: { command: 'npm run preview', url: 'http://127.0.0.1:5181', reuseExistingServer: !process.env.CI },
});
