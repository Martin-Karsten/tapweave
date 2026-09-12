import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { platform, arch } from 'node:os';
import assert from 'node:assert/strict';
import { root, compile, verifyCompiler } from './toolchain.mjs';
import { load_browser_runtime } from './browser-runtime.mjs';
const { Engine_Bridge } = await load_browser_runtime();

const compiler = verifyCompiler();
compile(['build', 'cost_native', '-o:speed', '-out:artifacts/input-cost-native']);
const directory = `${root}/artifacts/input-cost`;
await mkdir(directory, { recursive: true });
const wasm = await readFile(`${root}/artifacts/tapweave.wasm`);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const percentiles = durations => {
  const sorted = [...durations].sort((left, right) => left - right);
  return Object.fromEntries([50, 95, 99].map(percentile => [`p${percentile}_ns`, sorted[Math.ceil(sorted.length * percentile / 100) - 1]]));
};
const findings = [];
for (const [id, object_count, spacing_ms] of [['tiny', 10, 1000], ['dense', 10000, 1], ['sparse', 10000, 1000]]) {
  const map = 'osu file format v14\n[Difficulty]\nHPDrainRate:0\nOverallDifficulty:5\n[HitObjects]\n' +
    Array.from({ length: object_count }, (_, object_index) => `256,192,${1000 + object_index * spacing_ms},1,0`).join('\n');
  const map_path = `${directory}/${id}.osu`;
  await writeFile(map_path, map);
  const native_bytes = execFileSync(`${root}/artifacts/input-cost-native`, [map_path]);
  await writeFile(`${directory}/${id}.native.json`, native_bytes);
  const native = JSON.parse(native_bytes);
  const engine = await Engine_Bridge.create(wasm);
  const durations = [];
  let output;
  try {
    const prepared = engine.prepare_map(new TextEncoder().encode(map));
    const session = engine.create_session(prepared.map_handle, { input_capacity: 2048, batch_capacity: 1 });
    const memory_bytes = engine.wasm.memory.buffer.byteLength;
    for (let input_index = 0; input_index < native.input_count; input_index++) {
      const input_time_ms = 1000 + input_index;
      const started = process.hrtime.bigint();
      engine.submit_inputs(session, [{ sequence: BigInt(input_index + 1), raw_time_ms: input_time_ms,
        effective_time_ms: input_time_ms, x: 256, y: 192, action_bits: (input_index + 1) % 2 }]);
      output = engine.advance(session, input_time_ms);
      durations.push(Number(process.hrtime.bigint() - started));
      assert.equal(engine.wasm.memory.buffer.byteLength, memory_bytes);
    }
    assert.equal(output.summary.judgements_count, native.judgements);
    assert.equal(output.summary.audio_count, native.audio_events);
    const snapshot = engine.snapshot(session, 1999);
    assert.equal(Number(snapshot.summary.score), native.score);
    assert.equal(snapshot.summary.combo, native.combo);
  } finally {
    engine.dispose();
  }
  const { durations_ns, ...measurements } = native;
  findings.push({ id, fixture_sha256: digest(map), native_observation_sha256: digest(native_bytes), ...measurements,
    native: percentiles(durations_ns), wasm_bridge: percentiles(durations), wasm_memory_growth: 0 });
}
await writeFile(`${root}/reference/findings/m3-input-cost.json`, JSON.stringify({
  schema_version: 1, command: 'npm --prefix engine run measure:input-cost', compiler, platform: platform(), arch: arch(),
  wasm_sha256: digest(wasm), profile: 'unmodded-rate-1-zero-offset', findings,
  limitations: ['Preliminary input/advance measurements, not W09 performance approval',
    'WASM timings include allocating diagnostic bridge readers; separate m3-reader-cost evidence profiles production draw/voice readers',
    'Native hot path uses panic allocator; WASM verifies no memory growth',
    'Circle-only input workloads; mixed/long-overlap presentation costs remain in checkpoint 6'],
}, null, 2) + '\n');
console.log(JSON.stringify(findings, null, 2));
