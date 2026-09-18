import { access, copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { write_demo_assets } from './generate_demo.mjs';

const package_root = new URL('../', import.meta.url);
const engine_wasm = new URL('../../engine/artifacts/tapweave.wasm', package_root);
const public_wasm = new URL('../public/tapweave.wasm', import.meta.url);

try {
  await access(engine_wasm);
} catch {
  throw new Error('engine/artifacts/tapweave.wasm is missing; run `npm --prefix engine run build` first');
}

await mkdir(new URL('../public/', import.meta.url), { recursive: true });
await copyFile(engine_wasm, public_wasm);
console.log('Product assets: ' + fileURLToPath(public_wasm));

// The demo beatmap is generated (and verified against the tracked manifest)
// on every asset preparation pass; see scripts/demo/README.md.
const demo_path = await write_demo_assets(new URL('../public/demo/', import.meta.url));
console.log('Product assets: ' + demo_path);
