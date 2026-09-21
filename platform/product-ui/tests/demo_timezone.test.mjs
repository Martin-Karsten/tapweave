// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

describe('demo archive build timezone', () => {
  it('preserves the tracked bytes in every timezone', { timeout: 60000 }, () => {
    const package_root = fileURLToPath(new URL('../', import.meta.url));
    const manifest = JSON.parse(readFileSync(new URL('../scripts/demo/manifest.json', import.meta.url), 'utf8'));
    const script = `import { generate_demo_parts, demo_manifest_entries } from './scripts/generate_demo.mjs';
      console.log(JSON.stringify(demo_manifest_entries(generate_demo_parts())));`;
    for (const timezone of ['UTC', 'Europe/Berlin', 'America/Los_Angeles', 'Asia/Tokyo']) {
      const output = execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
        cwd: package_root,
        env: { ...process.env, TZ: timezone },
        encoding: 'utf8',
      });
      expect(JSON.parse(output), timezone).toEqual(manifest.outputs);
    }
  });
});
