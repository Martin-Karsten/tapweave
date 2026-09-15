import { defineConfig } from 'vitest/config';
import solid from 'vite-plugin-solid';
import { browser_source_resolver } from './vite.config.mts';

export default defineConfig({
  plugins: [browser_source_resolver, solid()],
  resolve: {
    conditions: ['development', 'browser'],
    alias: {
      '@browser': new URL('../browser-js/src', import.meta.url).pathname,
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.tsx', 'tests/**/*.test.ts'],
  },
});
