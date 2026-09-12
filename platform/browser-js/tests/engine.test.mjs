import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Engine_Bridge, Session_Output } from '../src/engine-bridge.mjs';
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

test('session bridge preserves retained outputs, acknowledgement and map ownership', async () => {
  const engine = await Engine_Bridge.create(wasm_bytes);
  try {
    const prepared = engine.prepare_map(map_bytes);
    const session = engine.create_session(prepared.map_handle, { input_capacity: 64, batch_capacity: 8 });
    engine.bind_sample(session, { object_id: 0, component_id: 0xffffffff, sample_index: 0, candidate_index: 0, asset_id: 7n });
    engine.release_map(prepared.map_handle);
    engine.submit_inputs(session, [{ sequence: 1n, raw_time_ms: 1000, effective_time_ms: 1000, x: 256, y: 192, action_bits: 1 }]);
    const buffer_before = engine.wasm.memory.buffer;
    const first = engine.advance(session, 1000);
    assert.equal(first.summary.judgements_count, 1);
    assert.equal(first.summary.audio_count, 1);
    assert.equal(first.record('audio', 0).asset_id, 7n);
    const retained_bytes = first.bytes.slice();
    const repeated = engine.snapshot(session, 5000);
    assert.equal(repeated.summary.committed_ms, first.summary.committed_ms);
    assert.equal(repeated.record('audio', 0).sequence, first.record('audio', 0).sequence);
    assert.throws(() => engine.acknowledge(session, first.summary.batch_token), { code: 'ENGINE_1' });
    engine.acknowledge(session, repeated.summary.batch_token);
    engine.acknowledge(session, repeated.summary.batch_token);
    assert.equal(engine.snapshot(session, 1000).summary.audio_count, 0);
    assert.deepEqual(first.bytes, retained_bytes);
    assert.equal(engine.wasm.memory.buffer, buffer_before);
    engine.advance(session, 2000);
    const final = engine.result(session);
    assert.equal(final.summary.state, 3);
    assert.equal(final.summary.accuracy, 1);
    const replay = engine.export_replay(session);
    engine.reset_session(session);
    engine.load_replay(session, replay);
    engine.seek_replay(session, 2000);
    assert.deepEqual(engine.result(session).bytes, final.bytes);
    engine.release_session(session);
    engine.release_session(session);
    assert.throws(() => engine.snapshot(session, 0));
    assert.equal(engine.session_handles.size, 0);
  } finally {
    engine.dispose();
  }
});

test('session input rejection is transactional and future records survive pause', async () => {
  const engine = await Engine_Bridge.create(wasm_bytes);
  try {
    const prepared = engine.prepare_map(map_bytes);
    const session = engine.create_session(prepared.map_handle, { input_capacity: 64, batch_capacity: 8 });
    engine.advance(session, 100);
    const input = { sequence: 1n, raw_time_ms: 1000, effective_time_ms: 1000, x: 256, y: 192, action_bits: 1 };
    assert.throws(() => engine.submit_inputs(session, [input, { ...input, sequence: 2n, action_bits: 8 }]));
    assert.throws(() => engine.submit_inputs(session, [{ ...input, raw_time_ms: 99, effective_time_ms: 99 }]), { code: 'ENGINE_7' });
    engine.submit_inputs(session, [input]);
    const paused = engine.pause(session, 100);
    assert.equal(paused.summary.state, 2);
    assert.throws(() => engine.advance(session, 200));
    engine.resume(session, { beatmap_ms: 100, audio_seconds: 50 });
    assert.equal(engine.advance(session, 2000).summary.accuracy, 1);
    assert.throws(() => engine.bind_sample(session, { object_id: 0, component_id: 0xffffffff, asset_id: 1n }));
  } finally {
    engine.dispose();
  }
});

test('production viewport transform handles placement, aspect ratio, DPR and rejects invalid candidates', async () => {
  const engine = await Engine_Bridge.create(wasm_bytes);
  try {
    for (const viewport of [
      { css_left: 17.25, css_top: -10, css_width: 1920, css_height: 1080, device_pixel_ratio: 2 },
      { css_left: -120, css_top: 90, css_width: 390, css_height: 844, device_pixel_ratio: 3 },
    ]) {
      const transform = engine.playfield_transform(viewport);
      for (const [x, y] of [[0, 0], [512, 384], [256.125, 192.25], [-20, 800]]) {
        const client_x = transform.client_left + x * transform.scale;
        const client_y = transform.client_top + y * transform.scale;
        assert.ok(Math.abs(client_x * transform.inverse_a + transform.inverse_e - x) <= 1e-6);
        assert.ok(Math.abs(client_y * transform.inverse_d + transform.inverse_f - y) <= 1e-6);
      }
      const previous_span = engine.read_span();
      const previous_bytes = engine.copy_output();
      assert.throws(() => engine.playfield_transform({ ...viewport, css_width: 0 }), { code: 'ENGINE_1' });
      assert.deepEqual(engine.read_span(), previous_span);
      assert.deepEqual(engine.copy_output(), previous_bytes);
    }
  } finally {
    engine.dispose();
  }
});

test('session output validates relative bounds, overlap and every nested record', async () => {
  const engine = await Engine_Bridge.create(wasm_bytes);
  try {
    const prepared = engine.prepare_map(map_bytes);
    const session = engine.create_session(prepared.map_handle, { input_capacity: 64, batch_capacity: 8 });
    const snapshot = engine.advance(session, 2000);
    for (const mutation of [
      { objects_offset: 0 }, { objects_count: 0xffffffff }, { objects_stride: 8 },
      { judgements_offset: snapshot.summary.objects_offset }, { audio_stride: 65 },
    ]) {
      const bytes = snapshot.bytes.slice();
      writeRecord(new DataView(bytes.buffer), 0, 19, { ...snapshot.summary, ...mutation });
      assert.throws(() => new Session_Output(bytes, 19));
    }
    const bytes = snapshot.bytes.slice();
    writeRecord(new DataView(bytes.buffer), snapshot.summary.objects_offset, 27);
    assert.throws(() => new Session_Output(bytes, 19), /Unsupported record/);
    assert.throws(() => snapshot.record('objects', -1));
    assert.throws(() => snapshot.record('objects', snapshot.summary.objects_count));
  } finally {
    engine.dispose();
  }
});
