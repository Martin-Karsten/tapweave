import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { Engine_Bridge, Gameplay_Output, Presentation_Output } from '../build/engine-bridge.js';
import { checkedSpan } from '../../../engine/abi/records.mjs';

// Synthetic three-minute workload: input fixtures, never upstream observations.
const map_text = 'osu file format v14\n[Difficulty]\nHPDrainRate:0\nOverallDifficulty:5\n' +
  'SliderMultiplier:1\nSliderTickRate:1\n[TimingPoints]\n0,500\n[HitObjects]\n' +
  '96,96,1000,1,0\n128,192,2000,2,0,L|328:192,2,200\n' +
  '256,192,5000,8,0,7000\n384,288,180000,1,0\n';
const inputs = [];
function input(time_ms, x, y, action_bits) {
  inputs.push({ sequence: BigInt(inputs.length + 1), raw_time_ms: time_ms,
    effective_time_ms: time_ms, x, y, action_bits });
}
input(1000, 96, 96, 1);
input(1100, 96, 96, 0);
input(2000, 128, 192, 1);
input(2500, 228, 192, 1);
input(3000, 328, 192, 1);
input(3500, 228, 192, 1);
input(4000, 128, 192, 1);
input(4100, 128, 192, 0);
const spinner_positions = [[356, 192], [256, 292], [156, 192], [256, 92]];
for (let sample_index = 0; sample_index <= 32; sample_index++) {
  const [x, y] = spinner_positions[sample_index % spinner_positions.length];
  input(5000 + sample_index * 50, x, y, 1);
}
input(7100, 384, 288, 0);
input(180000, 384, 288, 1);

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const directory = new URL('../artifacts/session/', import.meta.url);
await mkdir(directory, { recursive: true });
const map_bytes = new TextEncoder().encode(map_text);
const input_text = JSON.stringify(inputs, (_field_name, field_value) =>
  typeof field_value === 'bigint' ? field_value.toString() : field_value);
const manifest_bytes = await readFile(new URL('../../../engine/reference/source-manifest.json', import.meta.url));
const manifest = JSON.parse(manifest_bytes);
const wasm_bytes = await readFile(new URL('../../../engine/artifacts/tapweave.wasm', import.meta.url));
const engine = await Engine_Bridge.create(wasm_bytes);
const results = [];
try {
  const prepared = engine.prepare_map(map_bytes);
  for (const transport of ['diagnostic', 'compact']) {
    for (const frequency of [0, 30, 60, 120, 144]) {
      for (const stall_ms of frequency === 0 ? [0] : [0, 50, 100, 250]) {
        const session = engine.create_session(prepared.map_handle, { input_capacity: 128, batch_capacity: 64 });
        engine.submit_inputs(session, inputs);
        const memory_before = engine.wasm.memory.buffer;
        const judgement_hash = createHash('sha256');
        const audio_hash = createHash('sha256');
        const compact_output = new Gameplay_Output();
        const presentation_output = new Presentation_Output();
        const consume = target_ms => {
          const snapshot = transport === 'compact' ? engine.advance_output(session, target_ms, compact_output) :
            engine.advance(session, target_ms);
          for (const [field_name, digest] of [['judgements', judgement_hash], ['audio', audio_hash]]) {
            const span = transport === 'compact' ? snapshot[field_name] : snapshot.spans.get(field_name);
            const base_address = transport === 'compact' ? snapshot.address : 0;
            digest.update(checkedSpan(snapshot.view, base_address + span.offset, span.count, span.stride, 8));
          }
          // Rendering must preserve the pending event bytes and batch token.
          engine.presentation(session, target_ms, presentation_output);
          engine.acknowledge(session, snapshot.summary.batch_token);
          assert.equal(engine.snapshot(session, target_ms + 100).summary.audio_count, 0);
        };
        if (frequency) {
          let previous_target = 0;
          for (let target_ms = 0; target_ms < 181000; target_ms += 1000 / frequency) {
            if (stall_ms && target_ms >= 4900 && target_ms < 4900 + stall_ms) {
              continue;
            }
            assert.ok(target_ms >= previous_target);
            consume(target_ms);
            previous_target = target_ms;
          }
        }
        consume(181000);
        const final = engine.result(session);
        assert.equal(final.summary.state, 3);
        assert.equal(engine.wasm.memory.buffer, memory_before, 'advance/snapshot/ack grew WASM memory');
        const digests = { judgements: judgement_hash.digest('hex'), audio: audio_hash.digest('hex'), final: hash(final.bytes) };
        if (results.length) {
          assert.deepEqual(digests, results[0].digests, 'render cadence/stalls changed canonical output');
        }
        results.push({ transport, frequency, stall_ms, digests });
        engine.release_session(session);
      }
    }
  }
  engine.release_map(prepared.map_handle);
  assert.equal(engine.map_handles.size, 0);
  assert.equal(engine.session_handles.size, 0);
} finally {
  engine.dispose();
}
const report = { oracle: 'local-production-wasm-contract', upstream_verified: false, full_acceptance: false,
  reproduce: 'npm --prefix platform/browser-js run test:session',
  acceptance: ['A21', 'A23'], node_version: process.version, platform: process.platform, architecture: process.arch,
  source_commit: manifest.osu.commit, framework_commit: manifest.framework.commit,
  manifest_sha256: hash(manifest_bytes), wasm_sha256: hash(wasm_bytes),
  fixture_sha256: hash(map_bytes), inputs_sha256: hash(input_text), results };
await writeFile(new URL('map.osu', directory), map_bytes);
await writeFile(new URL('inputs.json', directory), input_text + '\n');
await writeFile(new URL('report.json', directory), JSON.stringify(report, null, 2) + '\n');
console.log(`${results.length} production-WASM schedules: exact judgement/audio/final digests; no WASM growth. Upstream acceptance remains open.`);
