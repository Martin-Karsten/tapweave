import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/multiplayer',
  workers: 1,
  timeout: 120_000,
  outputDir: './artifacts/multiplayer-browser',
  reporter: [['list'], ['json', { outputFile: './artifacts/multiplayer-browser.json' }]],
  use: {
    baseURL: process.env.MULTIPLAYER_TEST_URL ?? 'https://127.0.0.1:8788',
    screenshot: 'only-on-failure',
    ignoreHTTPSErrors: true,
  },
  projects: ['chromium', 'firefox', 'webkit'].map((browser_name) => ({
    name: browser_name,
    use: { browserName: browser_name },
  })),
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
