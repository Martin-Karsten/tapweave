import test from 'node:test';
import assert from 'node:assert/strict';
import { Gameplay_Frame } from '../build/gameplay-frame.js';
import { Gameplay_Input } from '../build/gameplay-input.js';
import { Audio_Clock } from '../build/clock.js';

function fixture(capacity = 8) {
  const calls = [];
  const callbacks = new Map();
  const clock = new Audio_Clock();
  clock.start(1, 0);
  clock.bind_session(1n, 2, 100, 1);
  const playback = { clock, session_handle: 1n, state: 'running', context: { currentTime: 1.02 },
    engine: { reserve_input() {}, submit_inputs(handle, records) { calls.push(['input', structuredClone(records)]); },
      session_playfield_transform() { return { inverse_a: 0.5, inverse_b: 0, inverse_c: 0, inverse_d: 0.5, inverse_e: -10, inverse_f: -20 }; } },
    pump(time) { calls.push(['pump', time]); return { summary: { state: 1 } }; },
    pause() { calls.push(['pause']); this.state = 'paused'; clock.pause(this.context.currentTime); },
    recover(error) { this.state = 'recovering'; this.error = error; } };
  let next_id = 0;
  const frame = new Gameplay_Frame(playback, time => calls.push(['render', time]), capacity,
    callback => { callbacks.set(++next_id, callback); return next_id; }, id => callbacks.delete(id));
  return { frame, playback, calls, callbacks };
}

test('frame submits audio-stamped input before advancing and retains future timestamps', () => {
  const { frame, calls } = fixture();
  frame.input.receive({ source_id: 'KeyZ', action: 1, held: true, audio_seconds: 1.02, clock_epoch: 1 });
  frame.step();
  assert.deepEqual(calls.map(call => call[0]), ['input', 'pump', 'render']);
  assert.ok(Math.abs(calls[0][1][0].raw_time_ms - 20) < 1e-10);
  assert.equal(calls[0][1][0].raw_time_ms, calls[0][1][0].effective_time_ms);
  assert.equal(frame.input.records.length, 0);
});

test('rejected input remains intact and cancels the driver without advancing', () => {
  const { frame, playback, calls, callbacks } = fixture();
  playback.engine.submit_inputs = () => { throw new Error('late input'); };
  frame.input.receive({ source_id: 'KeyZ', audio_seconds: 1.01, clock_epoch: 1 });
  frame.start();
  assert.throws(() => frame.step(), /late input/);
  assert.equal(frame.input.records[0].audio_seconds, 1.01);
  assert.equal(callbacks.size, 0);
  assert.equal(playback.state, 'recovering');
  assert.equal(calls.length, 0);
});

test('closed-epoch input is rejected visibly and never remapped through the new anchor', () => {
  const { frame, playback, calls, callbacks } = fixture();
  frame.input.receive({ source_id: 'KeyZ', action: 1, held: true, audio_seconds: 1.02, clock_epoch: 0 });
  frame.start();
  assert.throws(() => frame.step(), { code: 'INVALID_CLOCK' });
  assert.equal(frame.input.records[0].clock_epoch, 0);
  assert.equal(callbacks.size, 0);
  assert.equal(playback.state, 'recovering');
  assert.equal(calls.length, 0);
});

test('pause drains before the engine release; stale RAF cannot run after stop', () => {
  const { frame, calls, callbacks } = fixture();
  frame.input.receive({ source_id: 'KeyZ', action: 1, held: true, audio_seconds: 1.02, clock_epoch: 1 });
  frame.start();
  assert.throws(() => frame.start(), { code: 'INVALID_STATE' });
  const stale = callbacks.values().next().value;
  frame.pause();
  stale(10000);
  assert.deepEqual(calls.map(call => call[0]), ['input', 'pause']);
  assert.equal(frame.input.held_sources.size, 0);
  assert.equal(callbacks.size, 0);
});

function dispatch(target, type, fields) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, fields);
  target.dispatchEvent(event);
  return event;
}

test('DOM bindings aggregate mouse/keyboard, suppress repeats, ignore extra touches and release on blur', () => {
  const { frame, playback } = fixture(32);
  const window = new EventTarget();
  window.devicePixelRatio = 2;
  const document = new EventTarget();
  document.defaultView = window;
  const canvas = new EventTarget();
  Object.assign(canvas, { ownerDocument: document, style: { touchAction: 'auto' },
    getBoundingClientRect: () => ({ left: 20, top: 40, width: 1024, height: 768 }), setPointerCapture() {} });
  const binding = new Gameplay_Input(canvas, frame, () => 1.05);
  const mouse = { pointerType: 'mouse', pointerId: 1, button: 0, clientX: 200, clientY: 300 };
  assert.equal(dispatch(canvas, 'pointerdown', mouse).defaultPrevented, true);
  dispatch(window, 'keydown', { code: 'KeyZ', repeat: false });
  dispatch(window, 'keydown', { code: 'KeyZ', repeat: true });
  dispatch(window, 'pointerup', mouse);
  assert.deepEqual(frame.input.records.map(record => record.action_bits), [1, 1, 1]);
  assert.deepEqual([frame.input.records[0].x, frame.input.records[0].y], [90, 130]);
  dispatch(canvas, 'pointerdown', { ...mouse, pointerType: 'touch', pointerId: 2, isPrimary: false });
  assert.equal(frame.input.records.length, 3);
  dispatch(window, 'blur', {});
  assert.equal(playback.state, 'paused');
  assert.equal(frame.input.held_sources.size, 0);
  binding.dispose();
  assert.equal(canvas.style.touchAction, 'auto');
  playback.state = 'running';
  dispatch(window, 'keydown', { code: 'KeyX' });
  assert.equal(frame.input.records.length, 0);
});

test('production WASM frame delivery matches direct headless results across rates and stalls without growth', async () => {
  const { readFile } = await import('node:fs/promises');
  const { Engine_Bridge } = await import('../build/engine-bridge.js');
  const { Audio_Playback } = await import('../build/audio-playback.js');
  const { create_fallback_audio } = await import('../build/fallback-audio.js');
  const { load_sample_assets } = await import('../build/sample-assets.js');
  const { audio_context_fixture } = await import('./audio-fixture.mjs');
  const wasm = await readFile(new URL('../../../engine/artifacts/tapweave.wasm', import.meta.url));
  const map_text = 'osu file format v14\n[Difficulty]\nHPDrainRate:0\n[HitObjects]\n256,192,1000,1,0\n256,192,2000,1,0';
  const events = [[1000, true], [1100, false], [2000, true]];
  let expected;
  for (const rate of [0, 30, 60, 120, 144]) {
    for (const stall of [0, 50, 100, 250]) {
      const engine = await Engine_Bridge.create(wasm);
      let playback;
      try {
        const map = engine.prepare_map(new TextEncoder().encode(map_text));
        const session = engine.create_session(map.map_handle, { input_capacity: 32, batch_capacity: 32 });
        const context = audio_context_fixture();
        context.currentTime = 0;
        const samples = await load_sample_assets(map.descriptor, { async read() { return null; } }, 'map.osu', async () => {},
          engine.sample_probe(), { fallback_assets: create_fallback_audio(context) });
        playback = new Audio_Playback(engine, session, context, { music_buffer: { duration: 10 }, samples });
        const frame = new Gameplay_Frame(playback, () => {}, 32, () => 1, () => {});
        await playback.start(0);
        const memory_bytes = engine.wasm.memory.buffer.byteLength;
        if (rate === 0) {
          engine.submit_inputs(session, events.map(([time_ms, held], event_index) => ({ sequence: BigInt(event_index + 1),
            raw_time_ms: time_ms, effective_time_ms: time_ms, x: 256, y: 192, action_bits: held ? 1 : 0 })));
          context.currentTime = 3;
          playback.pump();
        } else {
          let event_index = 0;
          for (let frame_index = 1; frame_index <= rate * 3; frame_index++) {
            const time_ms = frame_index * 1000 / rate;
            if (time_ms > 950 && time_ms < 950 + stall) continue;
            while (event_index < events.length && events[event_index][0] <= time_ms) {
              const [receipt_ms, held] = events[event_index++];
              // Deliberately wrong diagnostic receipts: only the audio stamp may judge.
              frame.input.receive({ source_id: 'KeyZ', action: 1, held,
                audio_seconds: receipt_ms / 1000, clock_epoch: playback.clock.epoch,
                raw_time_ms: receipt_ms - 137 * (event_index % 3) + 61 });
            }
            context.currentTime = time_ms / 1000;
            frame.step();
          }
        }
        assert.equal(engine.wasm.memory.buffer.byteLength, memory_bytes);
        const result = engine.result(session);
        if (expected) assert.deepEqual(result, expected); else expected = result;
      } finally { playback?.dispose(); engine.dispose(); }
    }
  }
});

// Audio time advances in render-quantum blocks, so several events and successive
// callbacks can observe the same timestamp: sequence order decides, inputs land
// before scheduled transitions at the same time, and the boundary stamp equal to
// the committed target is admitted rather than rejected.
test('equal audio stamps keep sequence order before scheduled transitions at the committed boundary', async () => {
  const { readFile } = await import('node:fs/promises');
  const { Engine_Bridge } = await import('../build/engine-bridge.js');
  const { Audio_Playback } = await import('../build/audio-playback.js');
  const { create_fallback_audio } = await import('../build/fallback-audio.js');
  const { load_sample_assets } = await import('../build/sample-assets.js');
  const { audio_context_fixture } = await import('./audio-fixture.mjs');
  const wasm = await readFile(new URL('../../../engine/artifacts/tapweave.wasm', import.meta.url));
  const map_text = 'osu file format v14\n[Difficulty]\nHPDrainRate:0\n[HitObjects]\n256,192,1000,1,0\n256,192,2000,1,0';
  const events = [[1000, true], [1000, false], [1000, true], [1000, false], [2000, true], [2000, false]];
  let expected;
  for (const integrated of [false, true]) {
    const engine = await Engine_Bridge.create(wasm);
    let playback;
    try {
      const map = engine.prepare_map(new TextEncoder().encode(map_text));
      const session = engine.create_session(map.map_handle, { input_capacity: 32, batch_capacity: 32 });
      const context = audio_context_fixture();
      context.currentTime = 0;
      const samples = await load_sample_assets(map.descriptor, { async read() { return null; } }, 'map.osu', async () => {},
        engine.sample_probe(), { fallback_assets: create_fallback_audio(context) });
      playback = new Audio_Playback(engine, session, context, { music_buffer: { duration: 10 }, samples });
      const frame = new Gameplay_Frame(playback, () => {}, 32, () => 1, () => {});
      await playback.start(0);
      if (!integrated) {
        engine.submit_inputs(session, events.map(([time_ms, held], event_index) => ({ sequence: BigInt(event_index + 1),
          raw_time_ms: time_ms, effective_time_ms: time_ms, x: 256, y: 192, action_bits: held ? 1 : 0 })));
        context.currentTime = 3;
        playback.pump();
      } else {
        let event_index = 0;
        for (const frame_time_ms of [993, 1000, 1000, 1000, 1993, 2000, 2500]) {
          while (event_index < events.length && events[event_index][0] <= frame_time_ms) {
            const [time_ms, held] = events[event_index++];
            frame.input.receive({ source_id: 'KeyZ', action: 1, held,
              audio_seconds: time_ms / 1000, clock_epoch: playback.clock.epoch });
          }
          // The frame target can equal a previous stamp exactly.
          context.currentTime = frame_time_ms / 1000;
          frame.step();
        }
      }
      const result = engine.result(session);
      if (expected) assert.deepEqual(result, expected); else expected = result;
    } finally { playback?.dispose(); engine.dispose(); }
  }
});
