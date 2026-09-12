import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export function sourceInventory(fixtures, checkout) {
  const files = new Map();
  for (const fixture of fixtures) {
    for (const reference of [...fixture.upstream_tests, ...(fixture.source_symbols ?? [])]) {
      const [path, method] = reference.split('::');
      const bytes = readFileSync(resolve(checkout, path));
      if (method) assert.ok(bytes.toString().includes(`${method}(`), `Missing pinned test ${reference}`);
      if (!files.has(path)) files.set(path, { path, sha256: hash(bytes), methods: {} });
      if (method) {
        const methods = files.get(path).methods;
        (methods[method] ??= []).push(fixture.id);
      }
    }
  }
  return [...files.values()].sort((left, right) => left.path.localeCompare(right.path));
}
