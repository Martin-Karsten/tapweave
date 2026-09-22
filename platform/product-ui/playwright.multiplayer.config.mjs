import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/multiplayer',
  workers: 1,
  // Stop at the first CI failure instead of spending 13+ minutes on later rounds.
  maxFailures: process.env.CI ? 1 : undefined,
  timeout: 120_000,
  outputDir: './artifacts/multiplayer-browser',
  reporter: [['list'], ['json', { outputFile: './artifacts/multiplayer-browser.json' }]],
  use: {
    baseURL: process.env.MULTIPLAYER_TEST_URL ?? 'https://127.0.0.1:8788',
    screenshot: 'only-on-failure',
    ignoreHTTPSErrors: true,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium',
      // Match the other browser suites: CI provides Mesa under xvfb.
      launchOptions: process.env.CI && process.platform === 'linux'
        ? { args: ['--use-angle=gl', '--ignore-gpu-blocklist'] } : {},
    } },
    { name: 'firefox', use: { browserName: 'firefox',
      headless: !(process.env.CI && process.platform === 'linux'),
    } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  webServer: process.env.MULTIPLAYER_TEST_URL
    ? undefined
    : {
        command:
          'npx wrangler dev --config artifacts/deployment/wrangler.json --local-protocol https --ip 127.0.0.1 --port 8788 --var MULTIPLAYER_ENABLED:true',
        url: 'https://127.0.0.1:8788',
        reuseExistingServer: false,
        ignoreHTTPSErrors: true,
      },
});
