import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';

const assets_root = new URL('../dist/assets/', import.meta.url);
const asset_names = await readdir(assets_root);
const wasm_names = asset_names.filter(asset_name => /^tapweave-[\w-]+\.wasm$/.test(asset_name));
assert.equal(wasm_names.length, 1, 'one fingerprinted engine per release');
assert.ok((await readFile(new URL(wasm_names[0], assets_root))).equals(
  await readFile(new URL('../../../engine/artifacts/tapweave.wasm', import.meta.url))), 'deployed engine bytes match build input');
const script_names = asset_names.filter(asset_name => asset_name.endsWith('.js'));
const scripts = await Promise.all(script_names.map(asset_name => readFile(new URL(asset_name, assets_root), 'utf8')));
assert.ok(scripts.some(script => script.includes(`/assets/${wasm_names[0]}`)), 'JS references this release engine');
assert.ok(scripts.every(script => !script.includes('"/tapweave.wasm"')), 'no fixed engine URL');
assert.equal((await readdir(new URL('../dist/', import.meta.url))).includes('tapweave.wasm'), false);
for (const filename of ['_headers', '_redirects']) {
  assert.equal(await readFile(new URL('../dist/' + filename, import.meta.url), 'utf8'),
    await readFile(new URL('../hosting/' + filename, import.meta.url), 'utf8'));
}

// Exercise Vite's actual URL transform with two different binary contents,
// without modifying the production engine or release artifact.
const fixture_root = await mkdtemp(join(tmpdir(), 'tapweave-asset-hash-'));
try {
  await writeFile(join(fixture_root, 'entry.js'), 'import engine_url from "./tapweave.wasm?url"; console.log(engine_url);');
  const emitted_names = [];
  for (const byte_marker of [1, 2]) {
    await writeFile(join(fixture_root, 'tapweave.wasm'), Buffer.from([0, 97, 115, 109, byte_marker]));
    const result = await build({
      configFile: false, root: fixture_root, logLevel: 'silent',
      build: { write: false, assetsInlineLimit: 0, rollupOptions: { input: join(fixture_root, 'entry.js') } },
    });
    const outputs = (Array.isArray(result) ? result : [result]).flatMap(bundle => bundle.output);
    const wasm_asset = outputs.find(output => output.fileName.endsWith('.wasm'));
    assert.ok(wasm_asset);
    assert.ok(outputs.some(output => output.type === 'chunk' && output.code.includes(wasm_asset.fileName)));
    emitted_names.push(wasm_asset.fileName);
  }
  assert.notEqual(emitted_names[0], emitted_names[1], 'changed binary must change its URL');
} finally {
  await rm(fixture_root, { recursive: true, force: true });
}
console.log('Hosting asset integrity and fingerprint checks passed');
