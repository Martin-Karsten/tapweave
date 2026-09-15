import { access, constants } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import solid from 'vite-plugin-solid';

const package_root = fileURLToPath(new URL('.', import.meta.url));
const repo_root = fileURLToPath(new URL('../../', import.meta.url));
const browser_src_root = fileURLToPath(new URL('../browser-js/src', import.meta.url));

const path_exists = async (candidate: string) => {
  try {
    await access(candidate, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

// browser-js sources use node16-style ".js" specifiers for their ".ts" modules.
// TypeScript applies the extension substitution; esbuild/Vite does not, so the
// candidate ".ts" source is returned for unresolved in-package specifiers.
// Exported so the Vitest config resolves @browser imports identically.
export const browser_source_resolver: Plugin = {
  name: 'tapweave-browser-source-resolver',
  resolveId: {
    order: 'pre',
    async handler(source, importer) {
      if (!source.startsWith('.') || importer === null || !importer.startsWith(browser_src_root)) {
        return null;
      }
      const resolved = resolve(dirname(importer), source);
      if (resolved.endsWith('.js') && !(await path_exists(resolved))) {
        const source_candidate = `${resolved.slice(0, -3)}.ts`;
        if (await path_exists(source_candidate)) {
          return source_candidate;
        }
      }
      return null;
    },
  },
};

export default defineConfig({
  plugins: [browser_source_resolver, solid()],
  resolve: {
    alias: {
      '@browser': browser_src_root,
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5180,
    strictPort: true,
    fs: { allow: [package_root, repo_root] },
  },
  preview: { host: '127.0.0.1', port: 5181, strictPort: true },
});
