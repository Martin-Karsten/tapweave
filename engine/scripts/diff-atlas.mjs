import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { load_browser_runtime } from './browser-runtime.mjs';
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const { Engine_Bridge } = await load_browser_runtime();
const native = JSON.parse(execFileSync(resolve(root, 'artifacts/abi-native'), { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
const wasm_bytes = readFileSync(resolve(root, 'artifacts/tapweave.wasm'));
const engine = await Engine_Bridge.create(wasm_bytes);
const prepared = engine.prepare_map(new TextEncoder().encode('osu file format v14\n[Difficulty]\nHPDrainRate:0\nCircleSize:4\nApproachRate:5\nSliderMultiplier:1.4\nSliderTickRate:1\n[TimingPoints]\n0,500,4,1,1,100,1,0\n[HitObjects]\n100,100,1000,1,0\n150,180,1500,2,0,L|380:180|150:180,2,460\n256,192,5500,8,0,7000\n'));
const resources = engine.scene_resources(prepared.map_handle);
const wasm_out = resources.bytes;
const native_out = native.scene_resources;
console.log('lengths:', wasm_out.length, native_out.length);
// Atlas region: read offsets from the kind-46 header via the bridge summary.
const summary = resources.summary;
console.log('atlas span:', summary.atlas_offset, summary.atlas_offset + summary.atlas_count,
  'width/height:', summary.atlas_width, summary.atlas_height);
const cell_diffs = new Map();
let outside_atlas = 0;
for (let index = 0; index < Math.min(wasm_out.length, native_out.length); index++) {
  if (index >= 8 && index < 16) continue; // process-local resource_id
  if (wasm_out[index] === native_out[index]) continue;
  if (index < summary.atlas_offset || index >= summary.atlas_offset + summary.atlas_count) {
    outside_atlas++;
    continue;
  }
  const atlas_index = index - summary.atlas_offset;
  const texel = Math.floor(atlas_index / 4);
  const cell_x = Math.floor((texel % summary.atlas_width) / 32);
  const cell_y = Math.floor(Math.floor(texel / summary.atlas_width) / 32);
  const key = `cell(${cell_x},${cell_y})`;
  cell_diffs.set(key, (cell_diffs.get(key) ?? 0) + 1);
}
console.log('outside-atlas diffs:', outside_atlas);
console.log([...cell_diffs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20));
