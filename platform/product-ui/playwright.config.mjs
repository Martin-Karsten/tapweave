import { defineConfig } from '@playwright/test';

export default defineConfig({
  // GPU work and audio-clock tests need the runner's resources to themselves.
  workers: process.env.CI ? 1 : undefined,
  testDir: './tests/browser',
  outputDir: './artifacts/browser-results',
  reporter: [['list'], ['json', { outputFile: './artifacts/browser-results.json' }]],
  use: { baseURL: 'http://127.0.0.1:5181', screenshot: 'only-on-failure' },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium',
      // Match the browser-runtime suite's Mesa backend on Linux CI runners.
      launchOptions: process.env.CI && process.platform === 'linux'
        ? { args: ['--use-angle=gl', '--ignore-gpu-blocklist'] } : {},
    } },
    { name: 'firefox', use: { browserName: 'firefox',
      headless: !(process.env.CI && process.platform === 'linux'),
    } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  webServer: { command: 'npm run preview', url: 'http://127.0.0.1:5181', reuseExistingServer: !process.env.CI },
});
