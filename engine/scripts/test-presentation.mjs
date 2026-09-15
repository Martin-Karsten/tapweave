import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { root, compile, verifyCompiler } from './toolchain.mjs';

verifyCompiler();
compile(['build', 'presentation_native', '-o:speed', '-out:artifacts/presentation-native']);
compile(['build', 'presentation_wasm', '-target:js_wasm32', '-o:speed', '-out:artifacts/presentation.wasm']);
const native_values = JSON.parse(execFileSync(resolve(root, 'artifacts/presentation-native'), { encoding: 'utf8' }));
const { instance } = await WebAssembly.instantiate(readFileSync(resolve(root, 'artifacts/presentation.wasm')), {
  odin_env: { sin: Math.sin, cos: Math.cos, write: () => 0, rand_bytes: () => {} },
});
const wasm_values = native_values.map((_case_values, case_index) =>
  Array.from({ length: 9 }, (_unused_value, value_index) => instance.exports.trace_presentation_value(case_index, value_index)));
assert.deepEqual(wasm_values, native_values);
assert.deepEqual(native_values[0], [1, 0, 0, 1, 0, 0, 1, -0, -0]);
assert.deepEqual(native_values.slice(-7), [
  [0, 90, 180, 180, 180, 0.25, 180, 0, 0],
  [0, 90, 180, 180, 180, 0.25, 180, 0, 0],
  [90, 180, 270, 270, 270, 0.375, 270, 0, 0],
  [90, 180, 270, 270, 270, 0.375, 270, 0, 0],
  ...Array.from({ length: 3 }, () => [0, 1, 1, 220, 180, 0, 1, 0, 0]),
]);
writeFileSync(resolve(root, 'artifacts/presentation.json'), JSON.stringify({
  oracle: 'local-contract-only', acceptance: ['A12', 'A22'], complete: false, values: native_values,
  compiler: verifyCompiler(),
}, null, 2) + '\n');
console.log(`4 viewport, ${native_values.length - 11} circle boundary and 7 semantic projection fixtures: exact native/WASM values. Full A12/A22 remain open.`);
