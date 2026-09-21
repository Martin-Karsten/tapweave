import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const deployment_root = new URL('../artifacts/deployment/', import.meta.url);
const artifact_hashes = JSON.parse(await readFile(new URL('sha256.json', deployment_root), 'utf8'));
for (const [relative_path, expected_hash] of Object.entries(artifact_hashes)) {
  if (relative_path.includes('..') || relative_path.startsWith('/')) {
    throw new Error('Invalid artifact path');
  }
  const actual_hash = createHash('sha256')
    .update(await readFile(new URL(relative_path, deployment_root)))
    .digest('hex');
  if (actual_hash !== expected_hash) {
    throw new Error(`Deployment artifact changed: ${relative_path}`);
  }
}
console.log('Deployment artifact hashes verified.');
