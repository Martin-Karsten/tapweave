import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Engine_Bridge } from '../src/engine-bridge.mjs';
import { readRecord, writeRecord, checkedSpan } from '../../../engine/abi/records.mjs';

const wasm_bytes = await readFile(new URL('../../../engine/artifacts/tapweave.wasm', import.meta.url));
const map_bytes = new TextEncoder().encode('osu file format v14\n[General]\nAudioFilename: music.wav\n[HitObjects]\n256,192,1000,1,0');

test('generated ABI writes validate transactionally and preserve exact u64 values', () => {
  const view = new DataView(new ArrayBuffer(128));
  writeRecord(view, 0, 2, { token: 0xffffffffffffffffn, count: 15, flags: 2 });
  assert.equal(readRecord(view, 0, 2).token, 0xffffffffffffffffn);
  const original = new Uint8Array(view.buffer).slice();
  for (const invalid_fields of [{ count: -1 }, { token: 1 }, { flags: 2 ** 32 }, { invalid: 1 }]) {
    assert.throws(() => writeRecord(view, 0, 2, invalid_fields));
    assert.deepEqual(new Uint8Array(view.buffer), original);
  }
  assert.throws(() => checkedSpan(view, 64, Number.MAX_SAFE_INTEGER, 8));
  assert.throws(() => readRecord(view, 1, 2));
  view.setUint32(4, 136, true);
  assert.throws(() => readRecord(view, 0, 2));
});

test('production transport advertises preparation only and contains no trace exports', async () => {
  const engine = await Engine_Bridge.create(wasm_bytes);
  try {
    assert.equal(engine.capabilities.gameplay, 0);
    assert.equal(engine.preparation_capabilities.preparation_version, 2);
    assert.equal(Object.keys(engine.wasm).some(name => name.startsWith('trace_')), false);
    const prepared = engine.prepare_map(map_bytes);
    assert.equal(prepared.descriptor.summary.objects_count, 1);
    assert.equal(prepared.descriptor.audio_filename, 'music.wav');
    assert.throws(() => engine.prepare_map(new TextEncoder().encode('invalid')), { code: 'ENGINE_5' });
    assert.equal(engine.describe_map(prepared.map_handle).summary.objects_count, 1);
    engine.release_map(prepared.map_handle);
    engine.release_map(prepared.map_handle);
    assert.equal(prepared.descriptor.audio_filename, 'music.wav');
    assert.equal(engine.map_handles.size, 0);
  } finally {
    engine.dispose();
    engine.dispose();
  }
});

test('bridge reacquires views after actual WASM growth and failed reserve', async () => {
  const engine = await Engine_Bridge.create(wasm_bytes);
  try {
    const first = engine.prepare_map(map_bytes);
    const previous_buffer = engine.wasm.memory.buffer;
    engine.check_status(engine.wasm.oe_buffer_reserve(engine.engine_handle, 1, 8000000n, engine.result_address), false);
    assert.notEqual(engine.wasm.memory.buffer, previous_buffer);
    assert.equal(previous_buffer.byteLength, 0);
    assert.equal(engine.wasm.oe_buffer_reserve(engine.engine_handle, 1, 0xffffffffffffffffn, engine.result_address), 4);
    const second = engine.prepare_map(map_bytes);
    assert.equal(engine.describe_map(first.map_handle).summary.objects_count, 1);
    engine.release_map(second.map_handle);
    assert.equal(first.descriptor.audio_filename, 'music.wav');
  } finally {
    engine.dispose();
  }
});
