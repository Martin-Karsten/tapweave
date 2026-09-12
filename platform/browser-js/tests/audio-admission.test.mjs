import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine_Bridge, Gameplay_Output, Presentation_Output, Voice_Output } from '../src/engine-bridge.mjs';
import { Audio_Admission } from '../src/audio-admission.mjs';
import { Audio_Clock } from '../src/clock.mjs';
import { Audio_Service } from '../src/audio.mjs';
import { create_engine, two_circle_map as map_bytes, two_circle_inputs, voice_session } from './helpers.mjs';

async function fixture(maximum_pending = 8) {
  const engine = await create_engine();
  const session = await voice_session(engine, map_bytes, { input_capacity: 64, batch_capacity: 8 });
  for (const object_id of [0, 1]) {
    engine.bind_sample(session, { object_id, component_id: 0xffffffff, sample_index: 0, candidate_index: 0, asset_id: 7n });
  }
  engine.submit_inputs(session, two_circle_inputs);
  const compact = new Gameplay_Output();
  engine.advance_output(session, 1000, compact);
  const output = engine.voice_output(session, new Voice_Output());
  const clock = new Audio_Clock();
  clock.start(10, 1000);
  clock.bind_session(session, output.summary.epoch, 0, 10);
  const audio = new Audio_Service({ currentTime: 10, state: 'running' }, clock, { maximum_pending });
  return { engine, session, compact, output, clock, audio, admission: new Audio_Admission(engine, session, audio) };
}

test('production admission retries latest token without duplicating admitted sounds', async () => {
  const { engine, session, compact, output, audio, admission } = await fixture();
  try {
    const acknowledge = engine.acknowledge.bind(engine);
    engine.acknowledge = () => { throw new Error('injected acknowledgement failure'); };
    assert.throws(() => admission.admit(output), /injected/);
    assert.equal(audio.pending.length, 1);
    assert.equal(admission.admitted_sequence, 1n);
    engine.presentation(session, 1050, new Presentation_Output());
    engine.snapshot(session, 1050);
    engine.acknowledge = acknowledge;
    engine.advance_output(session, 2000, compact);
    engine.voice_output(session, output);
    admission.admit(output);
    assert.deepEqual(audio.pending.map(event => event.sequence), [1n, 2n]);
    assert.deepEqual(audio.pending.map(event => event.beatmap_time_ms), [1000, 2000]);
    admission.admit(output);
    assert.equal(audio.pending.length, 2);
    engine.advance_output(session, 2000, compact);
    assert.equal(engine.voice_output(session, output).summary.commands_count, 0);
    assert.equal(admission.admitted_sequence, 2n);
  } finally {
    engine.dispose();
  }
});

test('queue rejection preserves pending engine events and admission watermark', async () => {
  const { engine, session, compact, output, audio, admission } = await fixture(1);
  try {
    engine.advance_output(session, 2000, compact);
    engine.voice_output(session, output);
    assert.equal(output.summary.commands_count, 2);
    assert.throws(() => admission.admit(output), { code: 'QUOTA_EXCEEDED' });
    assert.equal(admission.admitted_sequence, 0n);
    assert.equal(audio.pending.length, 0);
    engine.advance_output(session, 2000, compact);
    assert.equal(engine.voice_output(session, output).summary.commands_count, 2);
  } finally {
    engine.dispose();
  }
});

test('dispatch cancellation keeps admitted watermark; new engine epoch accepts restarted sequences', async () => {
  const { engine, session, compact, output, clock, audio, admission } = await fixture();
  try {
    const acknowledge = engine.acknowledge.bind(engine);
    engine.acknowledge = () => { throw new Error('injected'); };
    assert.throws(() => admission.admit(output));
    audio.cancel();
    engine.acknowledge = acknowledge;
    admission.admit(output);
    assert.equal(audio.pending.length, 0);
    clock.pause(10);
    engine.reset_session(session);
    engine.submit_inputs(session, [{ sequence: 1n, raw_time_ms: 1000, effective_time_ms: 1000, x: 256, y: 192, action_bits: 1 }]);
    engine.advance_output(session, 1000, compact);
    engine.voice_output(session, output);
    assert.throws(() => admission.admit(output), { code: 'INVALID_CLOCK' });
    clock.start(11, 1000);
    clock.bind_session(session, output.summary.epoch, 1000, 11);
    audio.pump();
    admission.admit(output);
    assert.equal(audio.pending.length, 1);
    assert.equal(audio.pending[0].sequence, 1n);
  } finally {
    engine.dispose();
  }
});

test('production admission rejects offset vectors even when the independent clock can map them', async () => {
  const { engine, session, compact, output, clock, audio, admission } = await fixture();
  try {
    clock.pause(10);
    clock.start(11, 1000, { global_ms: 20, device_ms: -20 });
    clock.bind_session(session, output.summary.epoch, 1000, 11);
    assert.throws(() => admission.admit(output), { code: 'UNSUPPORTED_CLOCK_PROFILE' });
    assert.equal(audio.pending.length, 0);
    assert.equal(admission.admitted_sequence, 0n);
    engine.advance_output(session, 1000, compact);
    assert.equal(engine.voice_output(session, output).summary.commands_count, 1);
  } finally {
    engine.dispose();
  }
});
