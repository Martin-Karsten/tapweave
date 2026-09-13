import { defineConfig } from 'vitest/config';
import solid from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solid()],
  resolve: { conditions: ['development', 'browser'] },
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.tsx', 'tests/**/*.test.ts'],
  },
});
