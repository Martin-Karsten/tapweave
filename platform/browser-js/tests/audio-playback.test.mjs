import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Engine_Bridge, Gameplay_Output, Voice_Output } from '../build/engine-bridge.js';
import { Audio_Playback } from '../build/audio-playback.js';
import { Audio_Admission } from '../build/audio-admission.js';
import { Audio_Clock } from '../build/clock.js';
import { Audio_Service } from '../build/audio.js';
import { create_fallback_audio } from '../build/fallback-audio.js';
import { load_sample_assets, bind_sample_assets } from '../build/sample-assets.js';
import { audio_context_fixture } from './audio-fixture.mjs';

const wasm = await readFile(new URL('../../../engine/artifacts/tapweave.wasm', import.meta.url));
const header = 'osu file format v14\n[Difficulty]\nHPDrainRate:0\nSliderMultiplier:1.4\n[TimingPoints]\n0,500\n[HitObjects]\n';
const slider_map = header + '256,192,1000,2,0,L|396:192,1,140\n256,192,2500,1,0';
const inputs = [
  [1000, 256, 192, 1], [1150, 298, 192, 0], [1250, 326, 192, 1], [1500, 396, 192, 1],
].map(([time_ms, x, y, action_bits], input_index) => ({ sequence: BigInt(input_index + 1),
  raw_time_ms: time_ms, effective_time_ms: time_ms, x, y, action_bits }));
const missing_source = { async read() { return null; } };

async function prepare(engine, text = slider_map) {
  const map = engine.prepare_map(new TextEncoder().encode(text));
  const context = audio_context_fixture();
  const samples = await load_sample_assets(map.descriptor, missing_source, 'map.osu', async () => {},
    engine.sample_probe(), { fallback_assets: create_fallback_audio(context) });
  const session = engine.create_session(map.map_handle, { input_capacity: 128, batch_capacity: 128 });
  return { map, context, samples, session };
}

test('authoritative loop journal is identical across direct/frame/stall schedules and ack retries', async () => {
  let expected;
  for (const schedule of [[1600], [1000, 1150, 1250, 1500, 1600], Array.from({ length: 97 }, (_, frame_index) => frame_index * 1600 / 96)]) {
    const engine = await Engine_Bridge.create(wasm);
    try {
      const { session, samples } = await prepare(engine);
      const capacity = engine.voice_reserve(session);
      assert.throws(() => engine.voice_reserve(session, capacity.required_commands, capacity.required_bytes - 1n, 1), /status 4/);
      engine.voice_reserve(session, capacity.required_commands, capacity.required_bytes);
      bind_sample_assets(engine, session, samples);
      engine.submit_inputs(session, inputs);
      const memory_bytes = engine.wasm.memory.buffer.byteLength;
      const compact = new Gameplay_Output();
      const voice = new Voice_Output();
      const commands = [];
      for (const time_ms of schedule) {
        engine.advance_output(session, time_ms, compact);
        engine.voice_output(session, voice);
        assert.equal(voice.summary.flags, 1);
        for (let command_index = 0; command_index < voice.summary.commands_count; command_index++) commands.push(voice.record_into(command_index, {}));
        engine.acknowledge(session, voice.summary.batch_token);
        engine.acknowledge(session, voice.summary.batch_token);
      }
      assert.equal(engine.wasm.memory.buffer.byteLength, memory_bytes);
      if (expected) assert.deepEqual(commands, expected); else expected = commands;
      assert.deepEqual(commands.filter(command => command.command_kind === 2).map(command => command.time_ms), [1000, 1250]);
      assert.equal(commands.filter(command => command.command_kind === 3).length, 2);
      assert.ok(commands.every(command => command.asset_id > 0n));
    } finally { engine.dispose(); }
  }
});

test('spinner ramps replace the same voice and retire at end plus 240ms', async () => {
  const engine = await Engine_Bridge.create(wasm);
  try {
    const { session, samples } = await prepare(engine, header + '256,192,1000,8,0,2000\n256,192,2500,1,0');
    const capacity = engine.voice_reserve(session);
    engine.voice_reserve(session, capacity.required_commands, capacity.required_bytes);
    bind_sample_assets(engine, session, samples);
    const motion = [[1000, 256, 292], [1050, 356, 192], [1100, 356, 192], [1150, 256, 92], [1500, 156, 192]];
    engine.submit_inputs(session, motion.map(([time_ms, x, y], input_index) => ({ sequence: BigInt(input_index + 1),
      raw_time_ms: time_ms, effective_time_ms: time_ms, x, y, action_bits: 1 })));
    engine.advance_output(session, 2100, new Gameplay_Output());
    const output = engine.voice_output(session, new Voice_Output());
    const commands = Array.from({ length: output.summary.commands_count }, (_, command_index) => output.record_into(command_index, {}));
    const starts = commands.filter(command => command.command_kind === 2);
    assert.equal(starts.length, 1);
    const ramps = commands.filter(command => command.command_kind === 4 && command.parameter_mask === 1);
    assert.deepEqual(ramps.map(command => [command.volume, command.duration_ms]), [[1, 300], [0, 240], [1, 300], [0, 240]]);
    assert.equal(ramps[0].time_ms, 1050);
    const expected_decay_ms = 1150 + Math.log(10 / (90 * 0.99 ** 100 + 90)) / Math.log(0.99);
    assert.ok(Math.abs(ramps[1].time_ms - expected_decay_ms) < 1e-9);
    assert.equal(ramps[2].time_ms, 1500);
    assert.ok(ramps.every(command => command.voice_id === starts[0].voice_id));
    assert.equal(commands.find(command => command.command_kind === 3).time_ms, 2240);
  } finally { engine.dispose(); }
});

test('voice queue rejection retains output and failed acknowledgement never duplicates commands', async () => {
  const engine = await Engine_Bridge.create(wasm);
  try {
    const { session, samples, context } = await prepare(engine);
    const capacity = engine.voice_reserve(session);
    engine.voice_reserve(session, capacity.required_commands, capacity.required_bytes);
    bind_sample_assets(engine, session, samples);
    engine.submit_inputs(session, inputs);
    const compact = new Gameplay_Output();
    engine.advance_output(session, 1600, compact);
    const output = engine.voice_output(session, new Voice_Output());
    const clock = new Audio_Clock();
    clock.start(10, 1600);
    clock.bind_session(session, output.summary.epoch, 0, 10);
    const audio = new Audio_Service(context, clock, { maximum_pending: 64 });
    const enqueue = audio.enqueue.bind(audio);
    audio.enqueue = () => { const error = new Error('queue full'); error.code = 'QUOTA_EXCEEDED'; throw error; };
    const admission = new Audio_Admission(engine, session, audio);
    assert.throws(() => admission.admit(output), { code: 'QUOTA_EXCEEDED' });
    assert.equal(admission.admitted_sequence, 0n);
    audio.enqueue = enqueue;
    const acknowledge = engine.acknowledge.bind(engine);
    engine.acknowledge = () => { throw new Error('ack failure'); };
    assert.throws(() => admission.admit(output), /ack failure/);
    const pending_count = audio.pending.length;
    engine.voice_output(session, output);
    engine.acknowledge = acknowledge;
    admission.admit(output);
    assert.equal(audio.pending.length, pending_count);
  } finally { engine.dispose(); }
});

test('integrated music and hitsounds pause/resume on one anchor; dispatch failure stops both', async () => {
  const engine = await Engine_Bridge.create(wasm);
  try {
    const { session, samples, context } = await prepare(engine);
    const playback = new Audio_Playback(engine, session, context, { samples, music_buffer: { duration: 30 } });
    engine.submit_inputs(session, inputs);
    await playback.start(0, () => 0);
    context.currentTime = 11;
    playback.pump();
    assert.ok(playback.audio.voices.size >= 2);
    const first_music = playback.music.source;
    playback.pause();
    assert.equal(playback.state, 'paused');
    assert.equal(first_music.disconnected, true);
    assert.ok([...playback.audio.voices.values()].every(voice => voice.event.kind === 'one_shot'));
    context.currentTime = 20;
    await playback.start(undefined, () => 9000);
    assert.equal(playback.clock.beatmap_time(20), 1000);
    assert.notEqual(playback.music.source, first_music);
    context.currentTime = 20.3;
    context.createStereoPanner = () => { throw new Error('node allocation failure'); };
    assert.throws(() => playback.pump(), /node allocation failure/);
    assert.equal(playback.state, 'recovering');
    assert.equal(playback.music.source, null);
    assert.equal(playback.audio.voices.size, 0);
    assert.ok(context.sources.every(source => source.disconnected));
    playback.dispose();
  } finally { engine.dispose(); }
});

test('spinner pause reconstructs the sampled gain and remaining ramp under fresh identities', async () => {
  const engine = await Engine_Bridge.create(wasm);
  try {
    const { session, samples } = await prepare(engine, header + '256,192,1000,8,0,2000\n256,192,2500,1,0');
    const capacity = engine.voice_reserve(session);
    engine.voice_reserve(session, capacity.required_commands, capacity.required_bytes);
    bind_sample_assets(engine, session, samples);
    engine.submit_inputs(session, [
      { sequence: 1n, raw_time_ms: 1000, effective_time_ms: 1000, x: 256, y: 292, action_bits: 1 },
      { sequence: 2n, raw_time_ms: 1050, effective_time_ms: 1050, x: 356, y: 192, action_bits: 1 },
    ]);
    engine.advance_output(session, 1100, new Gameplay_Output());
    const output = engine.voice_output(session, new Voice_Output());
    const start = Array.from({ length: output.summary.commands_count }, (_, command_index) => output.record_into(command_index, {}))
      .find(command => command.command_kind === 2);
    engine.acknowledge(session, output.summary.batch_token);
    engine.pause(session, 1100);
    assert.throws(() => engine.voice_reserve(session, capacity.required_commands, capacity.required_bytes), /status 2/);
    engine.resume(session, { beatmap_ms: 1100, audio_seconds: 20 });
    engine.voice_output(session, output);
    const commands = Array.from({ length: output.summary.commands_count }, (_, command_index) => output.record_into(command_index, {}));
    const restored = commands.find(command => command.command_kind === 2);
    assert.notEqual(restored.voice_id, start.voice_id);
    assert.ok(Math.abs(restored.volume - 1 / 6) < 1e-12);
    const ramp = commands.find(command => command.command_kind === 4);
    assert.equal(ramp.voice_id, restored.voice_id);
    assert.equal(ramp.duration_ms, 250);
    assert.equal(ramp.volume, 1);
  } finally { engine.dispose(); }
});

test('disposed playback cannot be revived by a pending gesture resume', async () => {
  const engine = await Engine_Bridge.create(wasm);
  try {
    const { session, samples, context } = await prepare(engine);
    let resolve_resume;
    context.resume = () => new Promise(resolve => { resolve_resume = resolve; });
    const playback = new Audio_Playback(engine, session, context, { samples, music_buffer: { duration: 30 } });
    const starting = playback.start(0);
    playback.dispose();
    resolve_resume();
    await starting;
    assert.equal(playback.state, 'disposed');
    assert.equal(context.sources.length, 0);
  } finally { engine.dispose(); }
});

test('skip_forward re-anchors clock, music and session mapping in one synchronous jump', async () => {
  const engine = await Engine_Bridge.create(wasm);
  try {
    const { session, samples, context } = await prepare(engine);
    const playback = new Audio_Playback(engine, session, context, { samples, music_buffer: { duration: 30 } });
    engine.submit_inputs(session, inputs);
    await playback.start(0, () => 0);
    context.currentTime = 11;
    playback.pump();
    assert.equal(playback.last_committed_ms, 1000);
    const first_music = playback.music.source;
    const engine_epoch = playback.clock.session_mapping.engine_epoch;
    playback.skip_forward(2500);
    assert.equal(playback.state, 'running');
    assert.equal(playback.clock.anchor.beatmap_ms, 2500);
    assert.equal(playback.clock.session_mapping.engine_epoch, engine_epoch);
    assert.equal(playback.clock.session_mapping.browser_epoch, playback.clock.epoch);
    assert.equal(first_music.disconnected, true);
    const music_start = context.calls.filter(call => call[0] === 'start').at(-1);
    assert.equal(music_start[2], 2.5);
    context.currentTime = 11.1;
    playback.pump();
    assert.ok(Math.abs(playback.last_committed_ms - 2600) < 0.01);
    assert.throws(() => playback.skip_forward(playback.last_committed_ms), { code: 'INVALID_ARGUMENT' });
    playback.pause();
    assert.throws(() => playback.skip_forward(4000), { code: 'INVALID_STATE' });
  } finally { engine.dispose(); }
});

test('scheduled multiplayer music is armed ahead of time without advancing; cancellation stops the source', async () => {
  const engine = await Engine_Bridge.create(wasm);
  try {
    const { session, samples, context } = await prepare(engine);
    const playback = new Audio_Playback(engine, session, context, { samples, music_buffer: { duration: 10 } });
    const starting = playback.start(0, undefined, 15);
    await new Promise(resolve => setTimeout(resolve, 1));
    assert.deepEqual(context.calls.find(call => call[0] === 'start'), ['start', 15, 0]);
    assert.equal(playback.state, 'starting');
    assert.equal(playback.last_committed_ms, null);
    playback.dispose();
    await starting;
    assert.equal(playback.state, 'disposed');
    assert.ok(context.calls.some(call => call[0] === 'stop'));
  } finally {
    engine.dispose();
  }
});

test('scheduled launch anchors input to audio time and rejects late or interrupted starts', async () => {
  for (const outcome of ['on-time', 'late', 'interrupted', 'too-late-to-arm']) {
    const engine = await Engine_Bridge.create(wasm);
    try {
      const { session, samples, context } = await prepare(engine);
      const playback = new Audio_Playback(engine, session, context, { samples, music_buffer: { duration: 10 } });
      if (outcome === 'too-late-to-arm') {
        await assert.rejects(playback.start(0, undefined, context.currentTime), /deadline/);
      } else {
        const starting = playback.start(0, undefined, 15);
        // Attach rejection handling before changing the fixture's audio timeline.
        const launch_expectation = outcome === 'on-time' ? starting : assert.rejects(starting, /interrupted|late/);
        await new Promise(resolve => setTimeout(resolve, 1));
        if (outcome === 'interrupted') {
          context.state = 'suspended';
        } else {
          context.currentTime = outcome === 'late' ? 15.2 : 15;
        }
        await launch_expectation;
        if (outcome === 'on-time') {
          assert.equal(playback.clock.anchor.audio_seconds, 15);
          assert.ok(Math.abs(playback.clock.input_time(session, playback.voice_output.summary.epoch, 15.05) - 50) < 1e-9);
          assert.equal(playback.last_committed_ms, 0);
        }
      }
      playback.dispose();
    } finally {
      engine.dispose();
    }
  }
});
