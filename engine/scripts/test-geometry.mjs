import './verify-geometry-sources.mjs';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash, randomFillSync } from 'node:crypto';
import { root, compile, verifyCompiler } from './toolchain.mjs';
import { geometryFixtures } from './geometry-fixtures.mjs';

const compiler = verifyCompiler();
const artifact = resolve(root, 'artifacts/geometry');
mkdirSync(artifact, { recursive: true });
compile(['test', 'geometry_tests', '-out:artifacts/geometry-tests']);
compile(['build', 'geometry_native', '-o:speed', '-out:artifacts/geometry-native']);
compile(['build', 'geometry_wasm', '-target:js_wasm32', '-o:speed', '-out:artifacts/geometry.wasm', '-extra-linker-flags:--export-memory --max-memory=268435456']);
const fixtures = geometryFixtures();
const file = resolve(artifact, 'fixtures.json');
writeFileSync(file, JSON.stringify(fixtures));
const nativeText = execFileSync(resolve(root, 'artifacts/geometry-native'), [file], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
let memory;
const { instance } = await WebAssembly.instantiate(readFileSync(resolve(root, 'artifacts/geometry.wasm')), { odin_env: {
  sin: Math.sin, cos: Math.cos, acos: Math.acos, atan2: Math.atan2,
  write(fd, ptr, count) { (fd === 2 ? process.stderr : process.stdout).write(new Uint8Array(memory.buffer, ptr, count)); return count; },
  rand_bytes(ptr, count) { randomFillSync(new Uint8Array(memory.buffer, ptr, count)); },
} });
const wasm = instance.exports;
memory = wasm.memory;
const input = Buffer.from(JSON.stringify(fixtures));
const inbox = wasm.geometry_reserve(input.length);
assert.ok(inbox);
new Uint8Array(memory.buffer, inbox, input.length).set(input);
const size = wasm.geometry_run();
assert.ok(size, 'geometry test transport failed');
const wasmText = new TextDecoder().decode(new Uint8Array(memory.buffer, wasm.geometry_output(), size));
writeFileSync(resolve(artifact, 'native.json'), nativeText);
writeFileSync(resolve(artifact, 'wasm.json'), wasmText);
wasm.geometry_dispose();
wasm.geometry_dispose();
assert.equal(wasm.geometry_reserve(0xffffffff), 0);
assert.ok(wasmText === nativeText, `Native/WASM geometry traces differ; inspect ${artifact}`);
const native = JSON.parse(nativeText);
assert.equal(native.length, fixtures.length);
const schema = JSON.parse(readFileSync(resolve(root, 'geometry_trace/geometry.schema.json')));
// Validate this deliberately small schema without a runtime dependency.
function validateTrace(trace) {
  assert.deepEqual(Object.keys(trace).sort(), [...schema.items.required].sort());
  assert.equal(trace.schema_version, schema.items.properties.schema_version.const);
  assert.equal(typeof trace.id, 'string');
  assert.ok(schema.items.properties.status.enum.includes(trace.status));
  for (const field of ['vertices', 'samples']) {
    assert.ok(Array.isArray(trace[field]));
    for (const point of trace[field]) {
      assert.equal(point.length, 2);
      assert.ok(point.every(Number.isFinite));
    }
  }
  for (const field of ['cumulative', 'segment_ends']) assert.ok(Array.isArray(trace[field]) && trace[field].every(Number.isFinite));
  for (const field of ['distance', 'calculated_length']) assert.ok(Number.isFinite(trace[field]));
}
for (const trace of native) { validateTrace(trace); assert.equal(trace.status, 'OK', trace.id); }
assert.throws(() => validateTrace({ ...native[0], schema_version: 2 }));

// Safety failures are local contract checks, never submitted as upstream oracles.
// Reuse the same WASM instance after disposal to exercise the test transport too.
const base = fixtures.find(f => f.id === 'quadratic');
const failureFixtures = [
  { ...base, id: 'work-budget', options: { ...base.options, work_limit: 1 } },
  { ...base, id: 'negative-distance', options: { ...base.options, adjust_length: true, expected_length: -1 } },
  { ...base, id: 'invalid-degree-kind', points: base.points.map((p, i) => i ? p : { ...p, kind: 'Linear', degree: 2 }) },
  { ...base, id: 'non-f32-coordinate', points: base.points.map((p, i) => i ? p : { ...p, position: [1e100, 0] }) },
];
const failureFile = resolve(artifact, 'failure-fixtures.json');
const failureInput = Buffer.from(JSON.stringify(failureFixtures));
writeFileSync(failureFile, failureInput);
const failureNative = execFileSync(resolve(root, 'artifacts/geometry-native'), [failureFile], { encoding: 'utf8' }).trim();
const failurePtr = wasm.geometry_reserve(failureInput.length);
assert.ok(failurePtr);
new Uint8Array(memory.buffer, failurePtr, failureInput.length).set(failureInput);
const failureSize = wasm.geometry_run();
assert.ok(failureSize);
const failureWasm = new TextDecoder().decode(new Uint8Array(memory.buffer, wasm.geometry_output(), failureSize));
assert.ok(failureWasm === failureNative, 'Native/WASM geometry error traces differ');
const failureTraces = JSON.parse(failureNative);
failureTraces.forEach(validateTrace);
assert.deepEqual(failureTraces.map(t => t.status), ['Work_Limit', 'Invalid_Input', 'Invalid_Input', 'Invalid_Input']);
assert.ok(failureTraces.every(t => t.vertices.length === 0));
writeFileSync(resolve(artifact, 'failure-traces.json'), failureNative);
wasm.geometry_dispose();

let oracle;
let dotnetVersion = null;
if (process.argv.includes('--upstream')) {
  const dotnet = process.env.DOTNET_BIN || 'dotnet';
  dotnetVersion = execFileSync(dotnet, ['--version'], { encoding: 'utf8' }).trim();
  const project = resolve(root, 'geometry-reference-host/GeometryReference.csproj');
  execFileSync(dotnet, ['restore', project, '--locked-mode'], { stdio: 'inherit' });
  execFileSync(dotnet, ['build', project, '--no-restore', '-c', 'Release'], { stdio: 'inherit' });
  const output = execFileSync(dotnet, [resolve(root, 'geometry-reference-host/bin/Release/net10.0/GeometryReference.dll'), file], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  writeFileSync(resolve(artifact, 'upstream.json'), output);
  oracle = JSON.parse(output);
  assert.equal(oracle.length, fixtures.length);
  oracle.forEach(validateTrace);
}
const f32Ulp = x => Math.abs(x) < 2 ** -126 ? 2 ** -149 : 2 ** (Math.floor(Math.log2(Math.abs(x))) - 23);
const findings = [];
const records = fixtures.map((fixture, i) => {
  const actual = native[i], expected = oracle?.[i];
  let maxVertexError = 0, maxLengthError = 0, signedError = 0, coordinates = 0;
  const check = (a, b, tolerance, field) => {
    if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a - b) > tolerance) findings.push({ fixture: fixture.id, field, actual: a, expected: b, tolerance });
  };
  if (expected) {
    assert.equal(actual.id, expected.id);
    for (const key of ['vertices', 'samples']) {
      const values = actual[key] ?? [];
      assert.equal(values.length, expected[key].length, `${fixture.id}.${key}.length`);
      values.forEach((p, j) => p.forEach((x, axis) => {
        const ref = expected[key][j][axis];
        check(x, ref, Math.max(1e-4, 4 * f32Ulp(ref)), `${key}[${j}][${axis}]`);
        maxVertexError = Math.max(maxVertexError, Math.abs(x - ref));
        signedError += x - ref; coordinates++;
      }));
    }
    for (const key of ['cumulative', 'segment_ends']) {
      const values = actual[key] ?? [];
      assert.equal(values.length, expected[key].length, `${fixture.id}.${key}.length`);
      values.forEach((x, j) => { check(x, expected[key][j], 1e-4, `${key}[${j}]`); maxLengthError = Math.max(maxLengthError, Math.abs(x - expected[key][j])); });
    }
    for (const key of ['calculated_length', 'distance']) {
      check(actual[key], expected[key], 1e-4, key);
      maxLengthError = Math.max(maxLengthError, Math.abs(actual[key] - expected[key]));
    }
  }
  return { fixture: fixture.id, sha256: createHash('sha256').update(JSON.stringify(fixture)).digest('hex'),
    acceptance: ['A08', 'A09'], experiment: 'H03-geometry-subset', nativeWasmEqual: true,
    reproduce: 'npm --prefix engine run test:geometry:upstream',
    oracle: expected ? 'pinned-sliderpath-and-framework-package' : 'local-tests-only',
    maxVertexError, maxLengthError, meanSignedCoordinateError: coordinates ? signedError / coordinates : null };
});
const manifest = JSON.parse(readFileSync(resolve(root, 'reference/geometry/manifest.json')));
writeFileSync(resolve(artifact, 'acceptance.json'), JSON.stringify({ schemaVersion: 1, compiler,
  sources: manifest.files, frameworkPackage: '2026.731.0', dotnetVersion, platform: process.platform, architecture: process.arch,
  dependencyLockSha256: createHash('sha256').update(readFileSync(resolve(root, 'geometry-reference-host/packages.lock.json'))).digest('hex'),
  upstreamExecuted: Boolean(oracle), scope: 'independent-geometry', localFailureCases: failureTraces.map((t, i) => ({
    fixture: t.id, status: t.status, oracle: 'local-contract-only', nativeWasmEqual: true,
    sha256: createHash('sha256').update(JSON.stringify(failureFixtures[i])).digest('hex'),
  })), records, findings }, null, 2) + '\n');
assert.equal(findings.length, 0, JSON.stringify(findings.slice(0, 10), null, 2));
console.log(`${fixtures.length} geometry fixtures + ${failureTraces.length} local failure cases: native/WASM byte-identical; upstream ${oracle ? 'geometry comparisons passed' : 'not executed'}.`);
