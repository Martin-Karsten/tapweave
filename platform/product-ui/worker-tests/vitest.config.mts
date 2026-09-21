import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: '../wrangler.jsonc' },
      miniflare: { bindings: { MULTIPLAYER_ENABLED: 'true' } },
    }),
  ],
  test: {
    reporters: ['default', 'json'],
    outputFile: '../artifacts/worker-tests.json',
    include: ['*.test.ts'],
    testTimeout: 15_000,
  },
});
