import test from 'node:test';
import assert from 'node:assert/strict';
import { Audio_Clock } from '../src/clock.mjs';
import { Audio_Service } from '../src/audio.mjs';

function fake_context() {
  const calls = [];
  const sources = [];
  const parameter = () => ({
    setValueAtTime: (...values) => calls.push(['set', ...values]),
    cancelAndHoldAtTime: (...values) => calls.push(['hold', ...values]),
    linearRampToValueAtTime: (...values) => calls.push(['ramp', ...values]),
  });
  const node = () => ({ connect() {}, disconnect() { calls.push(['disconnect']); } });
  return { calls, sources, currentTime: 10, state: 'running', destination: {},
    createBufferSource() {
      const source = { ...node(), playbackRate: parameter(), start: when => calls.push(['start', when]), stop: when => calls.push(['stop', when]) };
      sources.push(source);
      return source;
    },
    createGain: () => ({ ...node(), gain: parameter() }),
    createStereoPanner: () => ({ ...node(), pan: parameter() }),
  };
}

function audio_event(clock, sequence, overrides = {}) {
  return { sequence: BigInt(sequence), epoch: clock.epoch, kind: 'one_shot', policy: 'drop',
    beatmap_time_ms: 0, voice_id: BigInt(sequence), asset_id: 1n, volume: 0.5, pan: 0, rate: 1,
    duration_ms: 0, lateness_threshold_ms: 50, ...overrides };
}

test('pause retains future one-shots, lets started sounds finish, and resumes nominal times once', () => {
  const context = fake_context();
  const clock = new Audio_Clock();
  clock.start(10, 0);
  const audio = new Audio_Service(context, clock);
  audio.set_assets(new Map([[1n, {}]]));
  audio.enqueue([audio_event(clock, 1), audio_event(clock, 2, { beatmap_time_ms: 20 }),
    audio_event(clock, 3, { beatmap_time_ms: 500 })]);
  audio.pump();
  assert.equal(audio.voices.size, 2);
  clock.pause(10);
  audio.suspend_one_shots();
  assert.equal(audio.voices.has(1n), true);
  assert.equal(audio.voices.has(2n), false);
  assert.deepEqual(audio.suspended_pending.map(event => event.beatmap_time_ms), [20, 500]);
  assert.throws(() => audio.set_assets(new Map()), { code: 'INVALID_STATE' });
  context.currentTime = 20;
  clock.resume(20);
  audio.pump();
  assert.equal(audio.suspended_pending.length, 2);
  audio.resume_one_shots();
  assert.equal(audio.pending.length, 2);
  audio.pump();
  assert.equal(audio.pending.length, 1);
  assert.deepEqual(context.calls.filter(call => call[0] === 'start').map(call => call[1]), [10, 10.02, 20.02]);
  assert.throws(() => audio.resume_one_shots(), { code: 'INVALID_STATE' });
  audio.cancel();
  assert.equal(audio.suspended_pending.length, 0);
});

test('clock offset vector is applied once with reversible conversion', () => {
  const clock = new Audio_Clock();
  clock.start(10, -500, { global_ms: 20, device_ms: -5, beatmap_ms: 10, user_ms: -2 });
  assert.equal(clock.beatmap_time(10), -477);
  assert.equal(clock.beatmap_time(11), 523);
  assert.equal(clock.audio_time(523), 11);
  assert.throws(() => clock.start(11, 0), { code: 'INVALID_STATE' });
  const previous_epoch = clock.epoch;
  assert.equal(clock.pause(11), 523);
  assert.equal(clock.beatmap_time(1000), 523);
  assert.ok(clock.epoch > previous_epoch);
  assert.throws(() => clock.audio_time(0), { code: 'INVALID_CLOCK' });
  clock.resume(1000);
  assert.equal(clock.beatmap_time(1000), 523);
  assert.equal(clock.beatmap_time(1001), 1523);
});

test('future sounds wait for lookahead and late one-shots drop', () => {
  const context = fake_context();
  const clock = new Audio_Clock();
  clock.start(10, 0);
  const audio = new Audio_Service(context, clock);
  audio.set_assets(new Map([[1n, {}]]));
  audio.enqueue([audio_event(clock, 1, { beatmap_time_ms: 100 })]);
  audio.pump();
  assert.equal(context.sources.length, 0);
  context.currentTime = 10.08;
  audio.pump();
  assert.deepEqual(context.calls.find(call => call[0] === 'start'), ['start', 10.1]);
  audio.enqueue([audio_event(clock, 2)]);
  audio.pump();
  assert.equal(audio.metrics.dropped, 1);
  assert.equal(audio.pending.length, 0);
  context.sources[0].onended();
  assert.equal(audio.voices.size, 0);
});

test('loop ramps, rapid stop/restart and epoch cancellation clean resources', () => {
  const context = fake_context();
  const clock = new Audio_Clock();
  clock.start(10, 0);
  const audio = new Audio_Service(context, clock);
  audio.set_assets(new Map([[1n, {}]]));
  audio.enqueue([
    audio_event(clock, 1, { kind: 'loop_start', voice_id: 5n }),
    audio_event(clock, 2, { kind: 'param_ramp', voice_id: 5n, duration_ms: 300, volume: 1 }),
    audio_event(clock, 3, { kind: 'loop_stop', voice_id: 5n, beatmap_time_ms: 10 }),
    audio_event(clock, 4, { kind: 'loop_start', voice_id: 5n, beatmap_time_ms: 20 }),
  ]);
  audio.pump();
  assert.equal(context.sources.length, 2);
  assert.equal(audio.voices.size, 1);
  assert.equal(audio.retiring_voices.size, 1);
  assert.ok(context.calls.some(call => call[0] === 'ramp' && call[1] === 1 && call[2] === 10.3));
  clock.pause(10.1);
  audio.pump();
  assert.equal(audio.voices.size, 0);
  assert.equal(audio.retiring_voices.size, 0);
  assert.equal(audio.pending.length, 0);
});

test('malformed batch rejects transactionally; new epoch retains new events', () => {
  const context = fake_context();
  const clock = new Audio_Clock();
  clock.start(10, 0);
  const audio = new Audio_Service(context, clock);
  audio.set_assets(new Map([[1n, {}]]));
  assert.throws(() => audio.enqueue([audio_event(clock, 1), audio_event(clock, 2, { beatmap_time_ms: NaN })]), { code: 'INVALID_AUDIO_EVENT' });
  assert.equal(audio.pending.length, 0);
  assert.equal(audio.last_sequence, 0n);
  const stale = audio_event(clock, 1);
  clock.pause(10);
  clock.start(10, 0);
  audio.enqueue([stale, audio_event(clock, 2)]);
  audio.pump();
  assert.equal(audio.metrics.stale, 1);
  assert.equal(context.sources.length, 1);
  audio.dispose();
  assert.equal(audio.assets.size, 0);
});

test('voice exhaustion cancels playback instead of blocking loop stops', () => {
  const context = fake_context();
  const clock = new Audio_Clock();
  clock.start(10, 0);
  const audio = new Audio_Service(context, clock, { maximum_voices: 1 });
  audio.set_assets([[1n, {}]]);
  audio.enqueue([
    audio_event(clock, 1, { kind: 'loop_start' }),
    audio_event(clock, 2, { kind: 'loop_start', beatmap_time_ms: 1 }),
    audio_event(clock, 3, { kind: 'loop_stop', voice_id: 1n, beatmap_time_ms: 2 }),
  ]);
  assert.throws(() => audio.pump(), { code: 'QUOTA_EXCEEDED' });
  assert.equal(audio.voices.size, 0);
  assert.equal(audio.retiring_voices.size, 0);
  assert.equal(audio.pending.length, 0);
  assert.ok(context.calls.some(call => call[0] === 'stop'));
  audio.pump();
  audio.enqueue([audio_event(clock, 4)]);
  audio.pump();
  assert.equal(context.sources.length, 2);
  audio.dispose();
});

test('epoch replacement counts only surviving events and validates before cancellation', () => {
  const context = fake_context();
  const clock = new Audio_Clock();
  clock.start(10, 0);
  const audio = new Audio_Service(context, clock, { maximum_pending: 1 });
  audio.enqueue([audio_event(clock, 1, { beatmap_time_ms: 5000 })]);
  const previous_pending = audio.pending.slice();
  const stale_event = audio_event(clock, 2);
  clock.pause(10);
  clock.resume(10);
  assert.throws(() => audio.enqueue([audio_event(clock, 2, { beatmap_time_ms: NaN })]), { code: 'INVALID_AUDIO_EVENT' });
  assert.throws(() => audio.enqueue([audio_event(clock, 2), audio_event(clock, 3)]), { code: 'QUOTA_EXCEEDED' });
  assert.deepEqual(audio.pending, previous_pending);
  assert.equal(audio.last_sequence, 1n);
  audio.enqueue([stale_event, audio_event(clock, 3)]);
  assert.equal(audio.pending.length, 1);
  assert.equal(audio.pending[0].sequence, 3n);
  assert.equal(audio.pending[0].epoch, clock.epoch);
  assert.equal(audio.metrics.stale, 1);
  assert.equal(audio.epoch, clock.epoch);
  audio.dispose();
});

test('session and browser epochs map explicitly without retiming receipt timestamps', () => {
  const clock = new Audio_Clock();
  clock.start(10, -500, { global_ms: 20 });
  clock.bind_session(99n, 17, 2000, 10);
  assert.equal(clock.mapped_epoch(99n, 17), 1);
  assert.equal(clock.input_time(99n, 17, 2250), -230);
  assert.equal(clock.input_time(99n, 17, 1500), -980);
  assert.throws(() => clock.mapped_epoch(99n, 1), { code: 'INVALID_CLOCK' });
  assert.throws(() => clock.mapped_epoch(98n, 17), { code: 'INVALID_CLOCK' });
  assert.throws(() => clock.bind_session(99n, 18, 2000, 10), { code: 'INVALID_STATE' });
  clock.pause(11);
  assert.throws(() => clock.input_time(99n, 17, 3000), { code: 'INVALID_CLOCK' });
  clock.resume(20);
  clock.bind_session(99n, 19, 5000, 20);
  assert.equal(clock.input_time(99n, 19, 5000), 520);
  assert.equal(clock.mapped_epoch(99n, 19), 3);
});

test('clock epoch exhaustion rejects without replacing the active anchor or mapping', () => {
  const clock = new Audio_Clock();
  clock.epoch = 0xfffffffe;
  clock.start(10, 0);
  clock.bind_session(1n, 9, 1000, 10);
  const anchor = clock.anchor;
  const mapping = clock.session_mapping;
  assert.throws(() => clock.pause(11), { code: 'QUOTA_EXCEEDED' });
  assert.equal(clock.anchor, anchor);
  assert.equal(clock.session_mapping, mapping);
  assert.equal(clock.paused_media_ms, 0);
  const exhausted = new Audio_Clock();
  exhausted.epoch = 0xffffffff;
  assert.throws(() => exhausted.start(10, 0), { code: 'QUOTA_EXCEEDED' });
  assert.equal(exhausted.anchor, null);
});
