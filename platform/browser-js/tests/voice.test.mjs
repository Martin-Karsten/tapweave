import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine_Bridge, Gameplay_Output, Voice_Output } from '../build/engine-bridge.js';
import { Audio_Admission } from '../build/audio-admission.js';
import { Audio_Clock } from '../build/clock.js';
import { Audio_Service } from '../build/audio.js';
import { create_engine, two_circle_map as map, voice_session } from './helpers.mjs';
import { schema, writeRecord } from '../../../engine/abi/records.mjs';
import { SESSION_INPUT_CAPACITY } from '../build/abi-records.js';

test('voice acknowledgement leaves unread judgements pending', async () => {
  const engine = await create_engine();
  try {
    const session = await voice_session(engine, map, { input_capacity: 8, batch_capacity: 1 });
    engine.submit_inputs(session, [{ sequence: 1n, raw_time_ms: 1000, effective_time_ms: 1000, x: 256, y: 192, action_bits: 1 }]);
    const compact = new Gameplay_Output();
    engine.advance_output(session, 1000, compact);
    const voice = engine.voice_output(session, new Voice_Output());
    engine.acknowledge(session, voice.summary.batch_token);
    engine.advance_output(session, 1000, compact);
    assert.equal(compact.judgements.count, 1);
    assert.equal(compact.audio.count, 0);
  } finally { engine.dispose(); }
});

test('voice production reserve, acknowledgement retry and admission share one watermark', async () => {
  const engine = await create_engine();
  try {
    assert.equal(engine.transport_capabilities.voice_version, 2);
    assert.equal(engine.transport_capabilities.voice_command_mask, 15);
    assert.equal(engine.capabilities.gameplay, 0);
    const session = await voice_session(engine, map, { input_capacity: 8, batch_capacity: 3 });
    const required = engine.voice_reserve(session);
    assert.equal(required.required_commands, 2);
    assert.throws(() => engine.voice_reserve(session, required.required_commands, required.required_bytes - 1n), /status 4/);
    assert.throws(() => engine.voice_reserve(session, 1, required.required_bytes), /status 4/);
    engine.voice_reserve(session, required.required_commands, required.required_bytes);
    engine.submit_inputs(session, [
      { sequence: 1n, raw_time_ms: 1000, effective_time_ms: 1000, x: 256, y: 192, action_bits: 1 },
      { sequence: 2n, raw_time_ms: 1500, effective_time_ms: 1500, x: 256, y: 192, action_bits: 0 },
      { sequence: 3n, raw_time_ms: 2000, effective_time_ms: 2000, x: 256, y: 192, action_bits: 1 },
    ]);
    const compact = new Gameplay_Output();
    engine.advance_output(session, 1000, compact);
    const voice = engine.voice_output(session, new Voice_Output());
    assert.equal(voice.summary.commands_count, 1);
    const command = voice.record_into(0, {});
    assert.equal(command.time_ms, 1000);
    assert.equal(command.voice_id, 1n);
    const clock = new Audio_Clock();
    clock.start(10, 1000);
    clock.bind_session(session, voice.summary.epoch, 0, 10);
    const audio = new Audio_Service({ currentTime: 10 }, clock);
    const admission = new Audio_Admission(engine, session, audio);
    const acknowledge = engine.acknowledge.bind(engine);
    engine.acknowledge = () => { throw new Error('ack failure'); };
    assert.throws(() => admission.admit(voice), /ack failure/);
    assert.equal(audio.pending.length, 1);
    engine.advance_output(session, 2000, compact);
    const refreshed = engine.voice_output(session, voice);
    assert.equal(refreshed.summary.commands_count, 2);
    assert.deepEqual([refreshed.record_into(0, {}).sequence, refreshed.record_into(1, {}).sequence], [1n, 2n]);
    engine.acknowledge = acknowledge;
    admission.admit(refreshed);
    assert.equal(audio.pending.length, 2);
    assert.equal(admission.admitted_sequence, 2n);
    assert.equal(engine.voice_output(session, voice).summary.commands_count, 0);
    assert.throws(() => engine.voice_reserve(session, required.required_commands, required.required_bytes), /status 2/);
    engine.reset_session(session, 0);
    engine.voice_reserve(session, required.required_commands, required.required_bytes);
    const memory_bytes = engine.wasm.memory.buffer.byteLength;
    engine.voice_output(session, voice);
    assert.equal(voice.summary.epoch, 2);
    assert.equal(engine.wasm.memory.buffer.byteLength, memory_bytes);
  } finally { engine.dispose(); }
});
test('voice reader validates every command family, reserved bytes, masks, spans and order', () => {
  const bytes = new Uint8Array(64 + 4 * 112);
  const view = new DataView(bytes.buffer);
  writeRecord(view, 0, 44, { epoch: 1, batch_token: 1n, commands_offset: 64, commands_count: 4,
    commands_stride: 112, total_bytes: BigInt(bytes.length) });
  for (let command_index = 0; command_index < 4; command_index++) {
    writeRecord(view, 64 + command_index * 112, 45, { sequence: BigInt(command_index + 1), epoch: 1,
      command_kind: command_index + 1, time_ms: 1500, voice_id: 7n, asset_id: 9n,
      volume: 0.5, pan: -0.2, rate: 1.5, late_policy: 2,
      duration_ms: command_index === 3 ? 300 : 0, parameter_mask: command_index === 3 ? 5 : 0 });
  }
  const output = new Voice_Output().bind(bytes);
  assert.equal(output.summary.commands_count, 4);
  for (const mutation of [
    { offset: 64, fields: { sequence: 0n } }, { offset: 64, fields: { epoch: 2 } },
    { offset: 64, fields: { command_kind: 5 } }, { offset: 64, fields: { reserved: 1 } },
  ]) {
    const malformed = bytes.slice();
    const changed = new DataView(malformed.buffer);
    const command_index = (mutation.offset - 64) / 112;
    writeRecord(changed, mutation.offset, 45, { ...output.record_into(command_index, {}), ...mutation.fields });
    assert.throws(() => new Voice_Output().bind(malformed), /voice command/);
  }
  for (const [record_offset, oversized_size] of [[0, 72], [64, 120]]) {
    const overlapping = bytes.slice();
    new DataView(overlapping.buffer).setUint32(record_offset + schema.transport.record_header.byte_size, oversized_size, true);
    assert.throws(() => new Voice_Output().bind(overlapping), /voice (frame|command)/);
  }
  const malformed = bytes.slice();
  writeRecord(new DataView(malformed.buffer), 0, 44, { ...output.summary, commands_offset: 0 });
  assert.throws(() => output.bind(malformed), /voice frame/);
  assert.equal(output.valid, false);
});

const long_slider_map = new TextEncoder().encode(`osu file format v14
[Difficulty]
HPDrainRate:0
SliderMultiplier:1.4
[TimingPoints]
0,500,4,1,1,100,1,0
[HitObjects]
256,192,1000,2,0,L|396:192,1100,140`);

test('voice ring wraps across sustained tracking changes without lost commands or WASM growth', async () => {
  const engine = await create_engine();
  try {
    const session = await voice_session(engine, long_slider_map, { input_capacity: SESSION_INPUT_CAPACITY, batch_capacity: 1 });
    const capacity = engine.voice_reserve(session);
    const output = new Gameplay_Output();
    const voice = new Voice_Output();
    const memory_bytes = engine.wasm.memory.buffer.byteLength;
    let last_sequence = 0n;
    for (let input_index = 0; input_index < 50_000; input_index++) {
      const time_ms = 1000 + input_index * 10;
      engine.submit_inputs(session, [{ sequence: BigInt(input_index + 1), raw_time_ms: time_ms,
        effective_time_ms: time_ms, x: 256 + (1 - Math.abs((input_index * 10 / 500) % 2 - 1)) * 140,
        y: input_index % 2 ? 1000 : 192, action_bits: 1 }]);
      engine.advance_output(session, time_ms, output);
      engine.voice_output(session, voice);
      for (let command_index = 0; command_index < voice.summary.commands_count; command_index++) {
        const command = voice.record_into(command_index, {});
        assert.equal(command.sequence, ++last_sequence);
        assert.ok(command.voice_id <= command.sequence);
      }
      engine.acknowledge(session, voice.summary.batch_token);
      // An acknowledgement retry must not move the ring's release watermark.
      if (input_index % 1000 === 0) engine.acknowledge(session, voice.summary.batch_token);
    }
    assert.ok(last_sequence > BigInt(capacity.required_commands));
    engine.advance_output(session, 552000, output);
    // The deliberately missed final repeats fail gameplay at the slider end.
    assert.equal(output.summary.state, 4);
    assert.equal(engine.wasm.memory.buffer.byteLength, memory_bytes);
  } finally { engine.dispose(); }
});

test('oversized advance and replay seek preserve state and output tokens before retry', async () => {
  const engine = await create_engine();
  try {
    const session = await voice_session(engine, long_slider_map, { input_capacity: SESSION_INPUT_CAPACITY, batch_capacity: 9000 });
    const inputs = Array.from({ length: 9000 }, (_, input_index) => ({ sequence: BigInt(input_index + 1),
      raw_time_ms: 1000 + input_index, effective_time_ms: 1000 + input_index, x: 256, y: 192, action_bits: 1 }));
    engine.submit_inputs(session, inputs);
    const before = engine.voice_output(session, new Voice_Output());
    const token = before.summary.batch_token;
    const memory_bytes = engine.wasm.memory.buffer.byteLength;
    assert.throws(() => engine.advance_output(session, 10000, new Gameplay_Output()), /status 4/);
    engine.acknowledge(session, token);
    assert.equal(engine.snapshot(session, 0).summary.committed_ms, 0);
    // The rejected advance retained every input. Smaller audio-clock intervals
    // can commit the same queued records without restamping or resubmitting.
    const output = new Gameplay_Output();
    for (const time_ms of [5000, 10000, 552000]) {
      engine.advance_output(session, time_ms, output);
      engine.acknowledge(session, engine.voice_output(session, new Voice_Output()).summary.batch_token);
    }
    // The deliberately missed final repeats fail gameplay at the slider end.
    assert.equal(output.summary.state, 4);
    const recording = engine.export_replay(session).slice();
    engine.reset_session(session, 0);
    engine.load_replay(session, recording);
    const replay_token = engine.voice_output(session, new Voice_Output()).summary.batch_token;
    assert.throws(() => engine.seek_replay(session, 10000), /status 4/);
    engine.acknowledge(session, replay_token);
    assert.equal(engine.snapshot(session, 0).summary.committed_ms, 0);
    assert.equal(engine.wasm.memory.buffer.byteLength, memory_bytes);
  } finally { engine.dispose(); }
});
