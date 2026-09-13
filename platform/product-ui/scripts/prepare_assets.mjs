import { access, copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

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
