import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Engine_Bridge, Session_Output, Gameplay_Output, Presentation_Output } from '../build/engine-bridge.js';
import { schema, readRecord, writeRecord, checkedSpan } from '../../../engine/abi/records.mjs';

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
    assert.equal(engine.output_capabilities.compact_version, 1);
    assert.equal(engine.output_capabilities.projection_version, 1);
    assert.equal(engine.output_capabilities.flags, 0);
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


test('compact advance reuses borrowed readers and preserves diagnostic events and final results', async () => {
  const engine = await Engine_Bridge.create(wasm_bytes);
  try {
    const prepared = engine.prepare_map(map_bytes);
    const session = engine.create_session(prepared.map_handle, { input_capacity: 64, batch_capacity: 8 });
    engine.submit_inputs(session, [{ sequence: 1n, raw_time_ms: 1000, effective_time_ms: 1000,
      x: 256, y: 192, action_bits: 1 }]);
    const output = new Gameplay_Output();
    const event = {};
    const memory_before = engine.wasm.memory.buffer;
    engine.advance_output(session, 1000, output);
    assert.equal(output.summary.objects_count, 0);
    assert.equal(output.summary.judgements_count, 1);
    assert.equal(output.record_into(output.judgements, 0, event), event);
    const first_sequence = event.sequence;
    const first_token = output.summary.batch_token;
    const compact_bytes = output.byte_count;
    const reusable_view = output.view;
    const reusable_summary = output.summary;
    const diagnostic = engine.snapshot(session, 2000);
    assert.equal(diagnostic.bytes.length, compact_bytes + schema.records.find(record => record.kind === 20).size);
    assert.equal(diagnostic.record('judgements', 0).sequence, first_sequence);
    assert.throws(() => engine.acknowledge(session, first_token), { code: 'ENGINE_1' });
    engine.advance_output(session, 2000, output);
    assert.equal(output.view, reusable_view);
    assert.equal(output.summary, reusable_summary);
    assert.equal(output.record_into(output.judgements, 0, event).sequence, first_sequence);
    engine.acknowledge(session, output.summary.batch_token);
    engine.acknowledge(session, output.summary.batch_token);
    engine.advance_output(session, 2000, output);
    assert.equal(output.judgements.count, 0);
    assert.equal(output.audio.count, 0);
    assert.equal(output.byte_count, schema.records.find(record => record.kind === 31).size);
    assert.equal(engine.wasm.memory.buffer, memory_before);
    const old_token = output.summary.batch_token;
    engine.reset_session(session);
    assert.throws(() => engine.acknowledge(session, old_token), { code: 'ENGINE_1' });
    const previous_span = engine.read_span();
    assert.equal(engine.wasm.oe_session_advance_output(engine.engine_handle, session, NaN, engine.result_address), 1);
    assert.deepEqual(engine.read_span(), previous_span);
    engine.advance_output(session, 0, output);
    assert.equal(output.summary.committed_ms, 0);
  } finally {
    engine.dispose();
  }
});

test('compact reader rejects truncated, overlapping and oversized records', async () => {
  const engine = await Engine_Bridge.create(wasm_bytes);
  try {
    const prepared = engine.prepare_map(map_bytes);
    const session = engine.create_session(prepared.map_handle, { input_capacity: 64, batch_capacity: 8 });
    const output = new Gameplay_Output();
    engine.advance_output(session, 2000, output);
    const buffer = engine.wasm.memory.buffer.slice(0);
    const view = new DataView(buffer);
    const record_address = output.address + output.judgements.offset;
    const original_size = view.getUint32(record_address + schema.transport.record_header.byte_size, true);
    view.setUint32(record_address + schema.transport.record_header.byte_size, output.judgements.stride + 8, true);
    const invalid_reader = new Gameplay_Output();
    assert.throws(() => invalid_reader.bind(buffer, engine.result_address), { code: 'INVALID_SPAN' });
    assert.equal(invalid_reader.valid, false);
    assert.throws(() => invalid_reader.record_into(invalid_reader.judgements, 0, {}), { code: 'INVALID_SPAN' });
    view.setUint32(record_address + schema.transport.record_header.byte_size, original_size, true);
    view.setUint32(output.address + schema.transport.record_header.byte_size, output.byte_count + 8, true);
    assert.throws(() => new Gameplay_Output().bind(buffer, engine.result_address), { code: 'INVALID_SPAN' });
    view.setUint32(output.address + schema.transport.record_header.byte_size,
      schema.records.find(record => record.kind === 31).size, true);
    const judgement_offset_field = schema.records.find(record => record.kind === 31).fields.judgements_offset[0];
    const original_offset = view.getUint32(output.address + judgement_offset_field, true);
    view.setUint32(output.address + judgement_offset_field, 0, true);
    assert.throws(() => new Gameplay_Output().bind(buffer, engine.result_address), { code: 'INVALID_SPAN' });
    view.setUint32(output.address + judgement_offset_field, original_offset, true);
    view.setUint32(engine.result_address + schema.transport.byte_span.count, 16, true);
    assert.throws(() => new Gameplay_Output().bind(buffer, engine.result_address), { code: 'INVALID_SPAN' });
  } finally {
    engine.dispose();
  }
});


test('active presentation has independent lifetime, stable order and bounded steady frame work', async () => {
  const engine = await Engine_Bridge.create(wasm_bytes);
  try {
    const objects = Array.from({ length: 10000 }, (_unused, object_index) =>
      '256,192,' + (1000 + object_index * 1000) + ',1,0');
    const prepared = engine.prepare_map(new TextEncoder().encode(
      'osu file format v14\n[Difficulty]\nHPDrainRate:0\n[HitObjects]\n' + objects.join('\n')));
    const session = engine.create_session(prepared.map_handle, { arena_bytes: 64n * 1024n * 1024n,
      input_capacity: 64, batch_capacity: 8 });
    const output = new Gameplay_Output();
    const frame = new Presentation_Output();
    const object = {};
    const buffer_before = engine.wasm.memory.buffer;
    engine.advance_output(session, 1000, output);
    const token = output.summary.batch_token;
    engine.presentation(session, 1000, frame);
    assert.ok(frame.objects.count < 5);
    const first_count = frame.objects.count;
    engine.presentation(session, 1001, frame);
    assert.equal(frame.summary.visited_count, BigInt(first_count));
    assert.equal(frame.summary.revealed_count, 0n);
    assert.equal(output.summary.batch_token, token);
    engine.acknowledge(session, token);
    engine.advance_output(session, 1400, output);
    assert.equal(output.judgements.count, 1);
    const event = {};
    output.record_into(output.judgements, 0, event);
    const pending_token = output.summary.batch_token;
    engine.presentation(session, 1400, frame);
    assert.equal(frame.record_into(frame.objects, 0, object).object_id, 0);
    assert.equal(object.result, event.result);
    assert.equal(output.record_into(output.judgements, 0, event).sequence, 1n);
    engine.acknowledge(session, pending_token);
    engine.presentation(session, 1400, frame);
    assert.equal(frame.record_into(frame.objects, 0, object).result, event.result);
    const previous_span = engine.read_span();
    assert.equal(engine.wasm.oe_session_presentation(engine.engine_handle, session, NaN, engine.result_address), 1);
    assert.deepEqual(engine.read_span(), previous_span);
    engine.presentation(session, 0, frame);
    assert.equal(frame.summary.committed_ms, 1400);
    engine.reset_session(session);
    engine.presentation(session, 0, frame);
    assert.equal(frame.summary.committed_ms, 0);
    assert.equal(frame.record_into(frame.objects, 0, object).result, 0);
    assert.equal(engine.wasm.memory.buffer, buffer_before);
  } finally {
    engine.dispose();
  }
});

test('immutable render attachment is shared across four session lifetimes', async () => {
  const engine = await Engine_Bridge.create(wasm_bytes);
  try {
    const prepared = engine.prepare_map(map_bytes);
    const sessions = Array.from({ length: 4 }, () => engine.create_session(prepared.map_handle, { input_capacity: 8, batch_capacity: 8 }));
    assert.throws(() => engine.session_render_resources(sessions[0]), { code: 'ENGINE_2' });
    const resources = engine.render_resources(prepared.map_handle);
    assert.equal(resources.summary.vertices_count, 4);
    assert.equal(resources.summary.indices_count, 6);
    assert.equal(resources.summary.atlas_count, 4);
    const buffer = engine.wasm.memory.buffer;
    const retained = engine.render_resources(prepared.map_handle);
    assert.deepEqual(retained.bytes, resources.bytes);
    engine.release_map(prepared.map_handle);
    for (const session of sessions) {
      const output = new Gameplay_Output();
      engine.advance_output(session, 1000, output);
      const token = output.summary.batch_token;
      assert.deepEqual(engine.session_render_resources(session).bytes, resources.bytes);
      engine.acknowledge(session, token);
      engine.reset_session(session);
      assert.deepEqual(engine.session_render_resources(session).bytes, resources.bytes);
      engine.release_session(session);
      assert.throws(() => engine.session_render_resources(session));
    }
    assert.equal(engine.wasm.memory.buffer, buffer);
    assert.equal(resources.summary.attachment_version, 1);
    assert.throws(() => engine.render_resources(prepared.map_handle));
  } finally {
    engine.dispose();
  }
});
