import './build.mjs';
execFileSync(process.execPath, [new URL('./generate-abi.mjs', import.meta.url).pathname, '--check']);
import { testABI } from './abi-test.mjs';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash, randomFillSync } from 'node:crypto';
import { resolve } from 'node:path';
import { root, compile, verifyCompiler } from './toolchain.mjs';
import { fixtures, referenceFixtures } from './fixtures.mjs';
import { validateTrace, firstDifference } from './trace-diff.mjs';

compile(['test', 'tests', '-out:artifacts/foundation-tests']);
const bytes = readFileSync(resolve(root, 'artifacts/decode.wasm'));
let memory;
const { instance } = await WebAssembly.instantiate(bytes, { odin_env: {
  sin: Math.sin, cos: Math.cos, pow: Math.pow,
  write(fd, ptr, count) {
    const value = new Uint8Array(memory.buffer, ptr, count);
    (fd === 2 ? process.stderr : process.stdout).write(value);
    return count;
  },
  rand_bytes(ptr, count) { randomFillSync(new Uint8Array(memory.buffer, ptr, count)); },
}});
const wasm = instance.exports;
memory = wasm.memory;
const fixtureDir = resolve(root, 'artifacts/fixtures');
mkdirSync(fixtureDir, { recursive: true });
const records = [];
for (const fixture of [...new Map([...fixtures(), ...referenceFixtures()].map(f=>[f.id,f])).values()]) {
  const input = Buffer.from(fixture.text);
  const path = resolve(fixtureDir, `${fixture.id}.osu`);
  writeFileSync(path, input);
  const nativeText = execFileSync(resolve(root, 'artifacts/decode-native'), [path], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trimEnd();
  const ptr = wasm.trace_reserve(input.length);
  assert.ok(ptr, 'inbox allocation failed');
  new Uint8Array(memory.buffer, ptr, input.length).set(input);
  const size = wasm.trace_decode();
  assert.ok(size, 'trace serialization failed');
  // Reacquire memory.buffer after every call which may grow WASM memory.
  const wasmText = new TextDecoder().decode(new Uint8Array(memory.buffer, wasm.trace_output(), size));
  const native = JSON.parse(nativeText), browser = JSON.parse(wasmText);
  validateTrace(native); validateTrace(browser);
  assert.equal(native.error.status, fixture.expectedStatus, fixture.id);
  const difference = firstDifference(native, browser);
  const sha256 = createHash('sha256').update(input).digest('hex');
  const record = { fixture: fixture.id, sha256, acceptance: fixture.acceptance, sourceCommit: '3c1c96f742e7aae2ff67a7361e058fe91ca3b955', oracle: 'local-tests-only', equal: nativeText === wasmText, difference, reproduce: `node engine/scripts/test.mjs` };
  records.push(record);
  assert.equal(difference, null, JSON.stringify(record));
  assert.equal(nativeText, wasmText, `Serialization differs: ${fixture.id}`);
  if (fixture.id === 'bom-whitespace-defaults') {
    assert.equal(native.difficulty.cs, 10); assert.equal(native.difficulty.ar, 4);
    assert.equal(native.metadata.title, '日本語');
  }
}
wasm.trace_dispose();
// A failed reserve is transactional; repeated disposal is safe.
assert.equal(wasm.trace_reserve(0xffffffff), 0);
wasm.trace_dispose();
assert.deepEqual(firstDifference({ a: [1, 2] }, { a: [1, 3] }), { path: '$.a.1', expected: 2, actual: 3 });
assert.ok(firstDifference([], [undefined]));
assert.throws(() => validateTrace({ schema_version: 2 }));
const lifecycle = testABI(wasm);
const report = { lifecycle, compiler: verifyCompiler(), schemaVersion: 1, upstreamVerified: false, records };
writeFileSync(resolve(root, 'artifacts/acceptance.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`${records.length} decoder fixtures: native/WASM traces byte-identical. Upstream compatibility remains unverified.`);
