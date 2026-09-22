import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Engine_Bridge, Session_Output, Gameplay_Output, Presentation_Output } from '../build/engine-bridge.js';
import { SESSION_STATE, RANK, FAIL_POLICY } from '../build/abi-records.js';
import { schema, readRecord, writeRecord, checkedSpan } from '../../../engine/abi/records.mjs';

const wasm_bytes = await readFile(new URL('../../../engine/artifacts/tapweave.wasm', import.meta.url));
const map_bytes = new TextEncoder().encode('osu file format v14\n[General]\nAudioFilename: music.wav\n[HitObjects]\n256,192,1000,1,0');
const metadata_map_bytes = new TextEncoder().encode('osu file format v14\n[General]\nAudioFilename: music.wav\n' +
  '[Metadata]\nTitle:Song Select Parity\nArtist:Test Artist\nCreator:Test Creator\nVersion:Field Coverage\n' +
  '[HitObjects]\n256,192,1000,1,0');

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

test('descriptor exposes decoder-owned metadata strings', async () => {
  const engine = await Engine_Bridge.create(wasm_bytes);
  try {
    const prepared = engine.prepare_map(metadata_map_bytes);
    assert.deepEqual(prepared.descriptor.metadata,
      { title: 'Song Select Parity', artist: 'Test Artist', creator: 'Test Creator', version: 'Field Coverage' });
    assert.deepEqual(engine.describe_map(prepared.map_handle).metadata, prepared.descriptor.metadata);
    // Stripped maps carry the pinned lazer decoder defaults as plain strings.
    const stripped = engine.prepare_map(map_bytes);
    assert.deepEqual(stripped.descriptor.metadata,
      { title: 'Unknown', artist: 'Unknown', creator: 'Unknown Creator', version: 'Normal' });
    engine.release_map(prepared.map_handle);
    engine.release_map(stripped.map_handle);
    // The descriptor copy outlives map release.
    assert.deepEqual(prepared.descriptor.metadata,
      { title: 'Song Select Parity', artist: 'Test Artist', creator: 'Test Creator', version: 'Field Coverage' });
  } finally {
    engine.dispose();
  }
});

// The pinned Skin/SampleStore probe order is engine policy; the bridge only
// decodes the published record.
test('sample probe policy publishes the pinned extension order from the engine', async () => {
  const engine = await Engine_Bridge.create(wasm_bytes);
  try {
    assert.deepEqual(engine.sample_probe(), ['', '.wav', '.mp3', '.ogg']);
    assert.deepEqual(engine.sample_probe(), ['', '.wav', '.mp3', '.ogg']);
  } finally {
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

test('session viewport transform uses pinned map-independent framing and validates handles and viewport', async () => {
  const engine = await Engine_Bridge.create(wasm_bytes);
  try {
    // One map with geometry far beyond the normal rectangle, one plain map:
    // the pinned lazer framing is viewport-only, so both must produce the
    // identical transform before any scene attachment exists.
    const extreme_map = engine.prepare_map(new TextEncoder().encode(
      'osu file format v14\n[HitObjects]\n-60,-40,1000,1,0\n560,420,2000,1,0\n100,100,4000,2,0,L|700:520,1,900'));
    const plain_map = engine.prepare_map(new TextEncoder().encode(
      'osu file format v14\n[HitObjects]\n256,192,1000,1,0'));
    const viewport = { css_left: 13.5, css_top: 29.25, css_width: 1280, css_height: 720, device_pixel_ratio: 1 };
    const extreme_session = engine.create_session(extreme_map.map_handle);
    const plain_session = engine.create_session(plain_map.map_handle);
    const transform = engine.session_playfield_transform(extreme_session, viewport);
    // 1920x1080 reference measurement: the default logical playfield frames
    // at exactly 1152x864 CSS pixels (0.8 * min(1920/512, 1080/384) = 2.25).
    const hd = engine.session_playfield_transform(plain_session,
      { css_left: 0, css_top: 0, css_width: 1920, css_height: 1080, device_pixel_ratio: 1 });
    assert.equal(hd.scale, 2.25);
    assert.equal(512 * hd.scale, 1152);
    assert.equal(384 * hd.scale, 864);
    assert.equal(hd.client_left, (1920 - 1152) / 2);
    assert.equal(hd.client_top, (1080 - 864) / 2);
    // Map independence: different geometry, identical transform.
    assert.deepEqual(engine.session_playfield_transform(plain_session, viewport), transform);
    // The session framing is the sessionless fit composed with the pinned
    // 0.8 playfield size adjustment.
    assert.equal(transform.scale, 0.8 * engine.playfield_transform(viewport).scale);
    assert.equal(transform.scale, 1.5);
    assert.equal(transform.client_left, 13.5 + (1280 - 512 * 1.5) / 2);
    assert.equal(transform.client_top, 29.25 + (720 - 384 * 1.5) / 2);
    // Objects beyond the logical rectangle map outside the framed playfield
    // rectangle but stay addressable on the canvas (no 512x384 clipping).
    const playfield_right = transform.client_left + 512 * transform.scale;
    const off_right = transform.client_left + 560 * transform.scale;
    assert.ok(off_right > playfield_right && off_right <= viewport.css_left + viewport.css_width);
    // Publishing the scene attachment changes nothing.
    engine.scene_resources(extreme_map.map_handle);
    assert.deepEqual(engine.session_playfield_transform(extreme_session, viewport), transform);
    // DPR never enters the CSS-space conversion.
    assert.deepEqual(engine.session_playfield_transform(extreme_session, { ...viewport, device_pixel_ratio: 4 }), transform);
    // Invalid viewports reject and preserve the previously published bytes.
    const previous_span = engine.read_span();
    const previous_bytes = engine.copy_output();
    assert.throws(() => engine.session_playfield_transform(extreme_session, { ...viewport, css_width: 0 }), { code: 'ENGINE_1' });
    assert.deepEqual(engine.read_span(), previous_span);
    assert.deepEqual(engine.copy_output(), previous_bytes);
    // Released sessions are stale handles, never a silent success.
    engine.release_session(extreme_session);
    engine.release_session(plain_session);
    assert.throws(() => engine.session_playfield_transform(extreme_session, viewport), { code: 'ENGINE_9' });
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

// Pinned multiplayer fail policy (MultiplayerPlayer.PerformFail): the
// MARK_AND_CONTINUE session keeps playing and scoring after zero health with a
// frozen F rank, while the default session stays terminally failed.
test('fail policy marks multiplayer failure without ending the run', async () => {
  const engine = await Engine_Bridge.create(wasm_bytes);
  try {
    const failing_map = new TextEncoder().encode('osu file format v14\n[Difficulty]\nHPDrainRate:10\nOverallDifficulty:5\n[HitObjects]\n256,192,1000,1,0\n320,192,1100,1,0\n400,192,1200,1,0\n480,192,1300,1,0\n560,192,1400,1,0\n100,100,1500,1,0\n64,64,3000,1,0\n64,64,3500,1,0\n64,64,4000,1,0\n64,64,4500,1,0');
    const map = engine.prepare_map(failing_map);
    const submit_late_hits = (session) => engine.submit_inputs(session, [
      { sequence: 1n, raw_time_ms: 3000, effective_time_ms: 3000, x: 64, y: 64, action_bits: 1 },
      { sequence: 2n, raw_time_ms: 3005, effective_time_ms: 3005, x: 64, y: 64, action_bits: 0 },
      { sequence: 3n, raw_time_ms: 3500, effective_time_ms: 3500, x: 64, y: 64, action_bits: 1 },
      { sequence: 4n, raw_time_ms: 3505, effective_time_ms: 3505, x: 64, y: 64, action_bits: 0 },
      { sequence: 5n, raw_time_ms: 4000, effective_time_ms: 4000, x: 64, y: 64, action_bits: 1 },
      { sequence: 6n, raw_time_ms: 4005, effective_time_ms: 4005, x: 64, y: 64, action_bits: 0 },
      { sequence: 7n, raw_time_ms: 4500, effective_time_ms: 4500, x: 64, y: 64, action_bits: 1 },
      { sequence: 8n, raw_time_ms: 4505, effective_time_ms: 4505, x: 64, y: 64, action_bits: 0 },
    ]);
    assert.throws(() => engine.create_session(map.map_handle, { fail_policy: 2 }), /Unknown fail policy/);
    const solo = engine.create_session(map.map_handle);
    submit_late_hits(solo);
    engine.advance(solo, 6000);
    const solo_result = engine.result(solo);
    assert.equal(Number(solo_result.summary.state), SESSION_STATE.FAILED);
    assert.equal(Number(solo_result.summary.rank), RANK.F);
    assert.equal(Number(solo_result.summary.score), 0);
    const room = engine.create_session(map.map_handle, { fail_policy: FAIL_POLICY.MARK_AND_CONTINUE });
    submit_late_hits(room);
    const mid_run = engine.advance(room, 3600);
    assert.equal(Number(mid_run.summary.state), SESSION_STATE.RUNNING);
    assert.equal(Number(mid_run.summary.health), 0);
    engine.advance(room, 6000);
    const room_result = engine.result(room);
    assert.equal(Number(room_result.summary.state), SESSION_STATE.PASSED);
    assert.equal(Number(room_result.summary.rank), 6);
    assert.ok(Number(room_result.summary.score) > 0);
    assert.equal(Number(room_result.summary.health), 0);
    engine.release_session(solo);
    engine.release_session(room);
    engine.release_map(map.map_handle);
  } finally {
    engine.dispose();
  }
});

test('activity ABI mirrors pinned break boundaries without growth and validates lifetimes', async () => {
  const engine = await Engine_Bridge.create(wasm_bytes);
  try {
    assert.equal(engine.capabilities.abi_minor, 2);
    const prepared = engine.prepare_map(new TextEncoder().encode('osu file format v14\n[Difficulty]\nHPDrainRate:0\n[Events]\n2,6000,6500\n2,8000,8650\n2,10000,14000\n[HitObjects]\n256,192,5000,1,0\n256,192,20000,1,0\n'));
    const session = engine.create_session(prepared.map_handle, { input_capacity: 64, batch_capacity: 32 });
    assert.equal(engine.session_activity(session), 'not_playing');
    const memory = engine.wasm.memory.buffer;
    for (const [time_ms, expected] of [[0, 'break'], [2999.999, 'break'], [3000, 'playing'], [6000, 'playing'], [6250, 'playing'], [6500, 'playing'], [7999.999, 'playing'], [8000, 'break'], [8325, 'break'], [8325.001, 'playing'], [10000, 'break'], [13675, 'break'], [13675.001, 'playing'], [21000, 'not_playing']]) {
      engine.advance(session, time_ms);
      assert.equal(engine.session_activity(session), expected, String(time_ms));
    }
    assert.equal(engine.wasm.memory.buffer, memory);
    assert.notEqual(engine.wasm.oe_session_activity(engine.engine_handle, session, 0), 0);
    engine.release_session(session);
    assert.throws(() => engine.session_activity(session));
  } finally { engine.dispose(); }
});
