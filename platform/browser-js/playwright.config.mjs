import { defineConfig } from '@playwright/test';

export default defineConfig({
  // GPU work and audio-clock tests need the runner's resources to themselves.
  workers: process.env.CI ? 1 : undefined,
  testDir: './tests/browser',
  outputDir: './artifacts/browser-results',
  reporter: [['list'], ['json', { outputFile: './artifacts/browser-results.json' }]],
  use: { baseURL: 'http://127.0.0.1:4173', screenshot: 'only-on-failure' },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium',
      // Linux CI supplies Xvfb and Mesa. Use that software GL implementation;
      // Chromium's default SwiftShader exceeds the long workload's time budget.
      launchOptions: process.env.CI && process.platform === 'linux'
        ? { args: ['--use-angle=gl', '--ignore-gpu-blocklist'] } : {},
    } },
    { name: 'firefox', use: { browserName: 'firefox',
      // Exercise the regular GL display path on the CI virtual display.
      headless: !(process.env.CI && process.platform === 'linux'),
    } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  webServer: { command: 'node scripts/serve.mjs', url: 'http://127.0.0.1:4173', reuseExistingServer: !process.env.CI },
});
