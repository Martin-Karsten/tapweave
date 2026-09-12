import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Engine_Bridge, Gameplay_Output, Voice_Output } from '../src/engine-bridge.mjs';
import { Audio_Admission } from '../src/audio-admission.mjs';
import { Audio_Clock } from '../src/clock.mjs';
import { Audio_Service } from '../src/audio.mjs';
import { schema, writeRecord } from '../../../engine/abi/records.mjs';

const wasm = await readFile(new URL('../../../engine/artifacts/tapweave.wasm', import.meta.url));
const map = new TextEncoder().encode('osu file format v14\n[Difficulty]\nHPDrainRate:0\n[HitObjects]\n256,192,1000,1,0\n256,192,2000,1,0');

test('voice acknowledgement leaves unread judgements pending', async () => {
  const engine = await Engine_Bridge.create(wasm);
  try {
    const prepared = engine.prepare_map(map);
    const session = engine.create_session(prepared.map_handle, { input_capacity: 8, batch_capacity: 1 });
    engine.voice_reserve(session, 2, 288n);
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

test('voice production reserve, overflow, acknowledgement retry and legacy admission share one watermark', async () => {
  const engine = await Engine_Bridge.create(wasm);
  try {
    assert.equal(engine.transport_capabilities.voice_version, 1);
    assert.equal(engine.transport_capabilities.voice_command_mask, 15);
    assert.equal(engine.capabilities.gameplay, 0);
    const prepared = engine.prepare_map(map);
    const session = engine.create_session(prepared.map_handle, { input_capacity: 8, batch_capacity: 3 });
    const required = engine.voice_reserve(session);
    assert.equal(required.required_commands, 2);
    engine.voice_reserve(session, 1, 176n);
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
    const old_bytes = new Uint8Array(voice.view.buffer, voice.view.byteOffset, voice.view.byteLength).slice();
    const clock = new Audio_Clock();
    clock.start(10, 1000);
    clock.bind_session(session, voice.summary.epoch, 0, 10);
    const audio = new Audio_Service({ currentTime: 10 }, clock);
    const admission = new Audio_Admission(engine, session, audio);
    const acknowledge = engine.acknowledge.bind(engine);
    engine.acknowledge = () => { throw new Error('ack failure'); };
    assert.throws(() => admission.admit_voice(voice), /ack failure/);
    assert.equal(audio.pending.length, 1);
    engine.advance_output(session, 2000, compact);
    assert.throws(() => engine.voice_output(session, voice), /status 8/);
    assert.equal(voice.required.required_commands, 2);
    assert.deepEqual(new Uint8Array(voice.view.buffer, voice.view.byteOffset, voice.view.byteLength), old_bytes);
    engine.acknowledge = acknowledge;
    admission.admit(compact);
    assert.equal(audio.pending.length, 2);
    assert.equal(admission.admitted_sequence, 2n);
    engine.voice_output(session, voice);
    assert.equal(voice.summary.commands_count, 0);
    assert.throws(() => engine.voice_reserve(session, 2, required.required_bytes), /status 2/);
    engine.reset_session(session, 0);
    engine.voice_reserve(session, 2, required.required_bytes);
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
    { offset: 64, fields: { rate: 0 } }, { offset: 64, fields: { reserved: 1 } },
    { offset: 64, fields: { flags: 1 } }, { offset: 400, fields: { parameter_mask: 0 } },
    { offset: 400, fields: { parameter_mask: 8 } },
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
