import './verify-sources.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, randomFillSync } from 'node:crypto';
import { root, compile, verifyCompiler } from './toolchain.mjs';
import { simulationFixtures, localSimulationFixtures } from './simulation-fixtures.mjs';
import { firstDifference } from './trace-diff.mjs';

const compiler = verifyCompiler();
const directory = resolve(root, 'artifacts/simulation');
mkdirSync(directory, { recursive: true });
compile(['test', 'simulation_tests', '-out:artifacts/simulation-tests']);
compile(['build', 'simulation_native', '-o:speed', '-out:artifacts/simulation-native']);
compile([
  'build', 'simulation_wasm', '-target:js_wasm32', '-o:speed', '-out:artifacts/simulation.wasm',
  '-extra-linker-flags:--export-memory --max-memory=268435456',
]);
const fixtures = [...simulationFixtures(), ...localSimulationFixtures()];
const fixturePath = resolve(directory, 'fixtures.json');
writeFileSync(fixturePath, JSON.stringify(fixtures));
const nativeText = execFileSync(resolve(root, 'artifacts/simulation-native'), [fixturePath], {
  encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
}).trim();
let memory;
const { instance } = await WebAssembly.instantiate(readFileSync(resolve(root, 'artifacts/simulation.wasm')), {
  odin_env: {
    pow: Math.pow, sqrt: Math.sqrt, sin: Math.sin, cos: Math.cos, atan2: Math.atan2,
    write(fileDescriptor, address, byteCount) {
      const stream = fileDescriptor === 2 ? process.stderr : process.stdout;
      stream.write(new Uint8Array(memory.buffer, address, byteCount));
      return byteCount;
    },
    rand_bytes(address, byteCount) {
      randomFillSync(new Uint8Array(memory.buffer, address, byteCount));
    },
  },
});
const wasm = instance.exports;
memory = wasm.memory;
const fixtureBytes = Buffer.from(JSON.stringify(fixtures));
const inboxAddress = wasm.simulation_reserve(fixtureBytes.length);
assert.ok(inboxAddress);
new Uint8Array(memory.buffer, inboxAddress, fixtureBytes.length).set(fixtureBytes);
const outputByteCount = wasm.simulation_run();
assert.ok(outputByteCount, 'simulation trace failed');
const wasmText = new TextDecoder().decode(
  new Uint8Array(memory.buffer, wasm.simulation_output(), outputByteCount),
);
writeFileSync(resolve(directory, 'native.json'), nativeText);
writeFileSync(resolve(directory, 'wasm.json'), wasmText);
wasm.simulation_dispose();
wasm.simulation_dispose();
assert.equal(wasm.simulation_reserve(0xffffffff), 0);
assert.ok(wasmText === nativeText, `Native/WASM trace mismatch; inspect ${directory}`);
const actual = JSON.parse(nativeText);
const schema = JSON.parse(readFileSync(resolve(root, 'simulation_trace/simulation.schema.json')));

function validate(observation) {
  assert.deepEqual(Object.keys(observation).sort(), schema.items.required.toSorted());
  assert.equal(observation.schema_version, 1);
  assert.equal(typeof observation.id, 'string');
  const fields = schema['x-value-fields'][observation.kind];
  assert.ok(fields, `Unknown kind ${observation.kind}`);
  assert.ok(Array.isArray(observation.values));
  for (const observationValue of observation.values) {
    assert.deepEqual(Object.keys(observationValue).sort(), Object.keys(fields).sort());
    for (const [fieldName, fieldType] of Object.entries(fields)) {
      const fieldValue = observationValue[fieldName];
      if (fieldType === 'counts') {
        assert.equal(fieldValue.length, 17);
        assert.ok(fieldValue.every(resultCount => Number.isInteger(resultCount) && resultCount >= 0));
      } else if (fieldType === 'number') {
        assert.ok(Number.isFinite(fieldValue));
      } else if (fieldType === 'key') {
        assert.deepEqual(Object.keys(fieldValue).sort(), [
          'time_ms', 'phase', 'object_index', 'component_index', 'input_sequence',
        ].sort());
        assert.ok(Number.isFinite(fieldValue.time_ms));
        assert.ok(['INPUT', 'TRACKING', 'JUDGEMENT', 'PARENT', 'SCORE_HEALTH', 'OUTPUT'].includes(fieldValue.phase));
        for (const keyField of ['object_index', 'component_index', 'input_sequence']) {
          assert.ok(Number.isSafeInteger(fieldValue[keyField]) && fieldValue[keyField] >= 0);
        }
      } else {
        assert.equal(typeof fieldValue, fieldType);
      }
    }
  }
}

actual.forEach(validate);
assert.equal(actual.length, fixtures.length);
assert.throws(() => validate({ ...actual[0], schema_version: 9 }));
assert.throws(() => validate({ ...actual[0], kind: 'unknown' }));
const scheduled = actual.filter(observation => observation.kind === 'events');
for (const observation of scheduled) {
  assert.deepEqual(observation.values, scheduled[0].values, observation.id);
}
assert.deepEqual(
  scheduled[0].values.map(event => event.id),
  Array.from({ length: 108 }, (_, eventIndex) => eventIndex + 1),
);
assert.deepEqual(
  actual.find(observation => observation.id === 'replay-equal-time').values.map(frame => [frame.x, frame.action_bits]),
  [[0, 0], [0, 0], [50, 0], [100, 2], [150, 2], [200, 2], [200, 2]],
);
for (const [fixtureId, expectedPosition] of [
  ['replay-subnormal-positive', 0], ['replay-subnormal-negative', 0],
]) {
  assert.deepEqual(
    actual.find(observation => observation.id === fixtureId).values,
    [{ x: expectedPosition, y: 0, action_bits: 1 }],
    fixtureId,
  );
}
assert.deepEqual(actual.find(observation => observation.kind === 'queue_overlap').values, [
  { status: 'INVALID_ARGUMENT', record_index: 0, queued_count: 0 },
  { status: 'INVALID_ARGUMENT', record_index: 0, queued_count: 3 },
]);
assert.deepEqual(actual.filter(observation => observation.kind === 'inputs').map(observation => observation.values[0]), [
  { status: 'OK', record_index: 0, queued_count: 2 },
  { status: 'INVALID_ARGUMENT', record_index: 1, queued_count: 0 },
  { status: 'LATE_INPUT', record_index: 0, queued_count: 0 },
  { status: 'INVALID_ARGUMENT', record_index: 1, queued_count: 0 },
  { status: 'INVALID_ARGUMENT', record_index: 1, queued_count: 0 },
  { status: 'QUOTA_EXCEEDED', record_index: 0, queued_count: 0 },
]);
assert.equal(actual.find(observation => observation.id === 'great-ok').values.at(-1).total, 399177);
assert.equal(actual.find(observation => observation.id === 'bonus-above-million').values.at(-1).total, 1000060);
for (const observation of actual.filter(observation => observation.kind === 'codec')) {
  const encoded = Buffer.from(observation.values[0].encoded, 'hex');
  assert.equal(encoded.subarray(0, 8).toString(), 'TWREPLAY');
  assert.equal(encoded.readUInt32LE(8), 2);
  assert.equal(encoded.readUInt32LE(12), 192);
  const frameCount = encoded.readUInt32LE(40);
  assert.equal(encoded.length, 192 + 64 * frameCount + 32);
  assert.equal(
    createHash('sha256').update(encoded.subarray(0, -32)).digest('hex'),
    encoded.subarray(-32).toString('hex'),
  );
  if (frameCount) {
    assert.equal(encoded.readDoubleLE(192 + 8), -100);
    assert.equal(encoded.readDoubleLE(192 + 24), 1 / 3);
  }
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
let upstream = null;
if (process.argv.includes('--upstream')) {
  execFileSync(process.execPath, [resolve(root, 'scripts/verify-sources.mjs'), '--require-checkouts'], { stdio: 'inherit' });
  const dotnet = process.env.DOTNET_BIN || 'dotnet';
  const project = resolve(root, 'reference-host/ReferenceHost.csproj');
  execFileSync(dotnet, ['restore', project, '--locked-mode'], { stdio: 'inherit' });
  execFileSync(dotnet, ['build', project, '--no-restore', '-p:RunAnalyzers=false'], { stdio: 'inherit' });
  const upstreamInput = resolve(directory, 'upstream-fixtures.json');
  writeFileSync(upstreamInput, JSON.stringify(simulationFixtures()));
  const upstreamText = execFileSync(dotnet, [
    resolve(root, 'reference-host/bin/Debug/net10.0/ReferenceHost.dll'), '--simulation', upstreamInput,
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  writeFileSync(resolve(directory, 'upstream.json'), upstreamText);
  upstream = JSON.parse(upstreamText);
  upstream.forEach(validate);
  assert.equal(upstream.length, simulationFixtures().length);
}
const manifest = JSON.parse(readFileSync(resolve(root, 'reference/source-manifest.json')));
const acceptanceByKind = {
  score: ['A17', 'A18'], drain: ['A19'], properties: ['A17'], windows: ['A13'], spin: ['A16'],
  slider_position: ['A14', 'A15'], round: ['A18'], events: ['A23'], inputs: ['A23'], replay: ['A23'], codec: ['A23'], queue_overlap: ['A23'],
};
const experimentByKind = {
  score: 'H10-subset', drain: 'H09-calibration-subset', properties: 'H10-subset',
  slider_position: 'H07-position-subset', replay: 'H11-cursor-subset', windows: 'H06-windows-subset', spin: 'H08-history-subset', round: 'H10-subset',
};
const records = fixtures.map((fixture, fixtureIndex) => {
  const expected = upstream?.find(observation => observation.id === fixture.id);
  return {
    fixture: fixture.id,
    sha256: hash(JSON.stringify(fixture)),
    acceptance: acceptanceByKind[fixture.kind],
    experiment: experimentByKind[fixture.kind] ?? null,
    oracle: expected ? 'pinned-upstream-component' : 'local-contract-only',
    nativeWasmEqual: true,
    reproduce: expected ? 'npm --prefix engine run test:simulation:upstream' : 'npm --prefix engine run test:simulation',
    observationSha256: hash(JSON.stringify(expected ?? actual[fixtureIndex])),
    difference: expected ? firstDifference(expected, actual[fixtureIndex]) : null,
  };
});
const report = {
  schemaVersion: 1, compiler, platform: process.platform, architecture: process.arch,
  sourceCommit: manifest.osu.commit, frameworkCommit: manifest.framework.commit,
  lockSha256: hash(readFileSync(resolve(root, 'reference-host/packages.lock.json'))),
  upstreamExecuted: Boolean(upstream), m2Complete: false,
  scope: 'Independent result/scoring, hit-window, forward spin, drain-calibration, repeated-slider position and replay cursor components; local event/input and replay codec primitives. No whole-drawable or production-session oracle.',
  records,
};
writeFileSync(resolve(directory, 'acceptance.json'), JSON.stringify(report, null, 2) + '\n');
const failures = records.filter(record => record.difference);
assert.equal(failures.length, 0, JSON.stringify(failures.slice(0, 10), null, 2));
console.log(`${fixtures.length} M2 primitive fixtures: byte-identical native/WASM; ${upstream ? `${upstream.length} pinned component comparisons passed` : 'upstream not executed'}. Full M2 remains gated.`);
