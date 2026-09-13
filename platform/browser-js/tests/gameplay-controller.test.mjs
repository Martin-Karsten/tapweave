import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Engine_Bridge, Gameplay_Output } from '../build/engine-bridge.js';
import { Gameplay_Controller } from '../build/gameplay-controller.js';
import { Selection_Controller } from '../build/selection.js';
import { create_fallback_audio } from '../build/fallback-audio.js';
import { load_sample_assets } from '../build/sample-assets.js';
import { audio_context_fixture } from './audio-fixture.mjs';

const wasm = await readFile(new URL('../../../engine/artifacts/tapweave.wasm', import.meta.url));
const mixed_map = `osu file format v14
[Difficulty]
HPDrainRate:0
[TimingPoints]
0,500,4,1,1,100,1,0
[HitObjects]
256,192,1000,1,0
256,192,2000,2,0,L|356:192,1,100
256,192,3000,8,0,4000`;

function dispatch(target, type, fields = {}) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, fields);
  target.dispatchEvent(event);
}

async function fixture({ map_text = mixed_map, renderer_failure = false, music = true } = {}) {
  const engine = await Engine_Bridge.create(wasm);
  const context = Object.assign(new EventTarget(), audio_context_fixture());
  context.currentTime = 0;
  context.close = async () => { context.state = 'closed'; };
  const window = Object.assign(new EventTarget(), { devicePixelRatio: 1 });
  const document = Object.assign(new EventTarget(), { defaultView: window, hidden: false });
  const canvas = Object.assign(new EventTarget(), { ownerDocument: document, style: { touchAction: 'auto' },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 480 }), setPointerCapture() {} });
  const map = engine.prepare_map(new TextEncoder().encode(map_text));
  const source = { async read() { return null; }, dispose() {}, list_maps: () => ['map.osu'] };
  const samples = await load_sample_assets(map.descriptor, source, 'map.osu', async () => {},
    engine.sample_probe(), { fallback_assets: create_fallback_audio(context) });
  const selection = new Selection_Controller(engine);
  selection.active = { ...map, source, filename: 'map.osu', music_buffer: music ? { duration: 10 } : null,
    samples, music_status: music ? 'decoded' : 'missing', music_error: music ? null : 'Missing music.' };
  selection.state = 'prepared';
  const callbacks = new Map();
  const renderers = [];
  const views = [];
  let next_identifier = 0;
  const controller = new Gameplay_Controller(engine, selection, context, canvas, {
    request_frame: callback => { callbacks.set(++next_identifier, callback); return next_identifier; },
    cancel_frame: identifier => callbacks.delete(identifier),
    create_renderer(engine, session, map, canvas, epoch, lost) {
      if (renderer_failure) throw new Error('GPU preparation failed');
      const renderer = { ready: true, restores: 0, lost,
        render() {}, restore() { this.restores++; this.ready = true; }, dispose() { this.ready = false; } };
      renderers.push(renderer); return renderer;
    },
    on_change: view => views.push(view),
  });
  const frame = time_ms => {
    context.currentTime = time_ms / 1000;
    const scheduled = [...callbacks.values()]; callbacks.clear();
    for (const callback of scheduled) callback(time_ms);
  };
  // The DOM handler runs while the audio clock sits at the event time: the
  // fixture models event receipt exactly on the sampled audio timestamp.
  const key = (time_ms, held) => {
    context.currentTime = time_ms / 1000;
    dispatch(window, held ? 'keydown' : 'keyup', { code: 'KeyZ', repeat: false });
  };
  return { engine, context, window, document, canvas, selection, controller, callbacks, renderers, views, frame, key };
}

test('missing music and failed GPU preparation leave selection intact and no session leaks', async () => {
  for (const settings of [{ music: false }, { renderer_failure: true }]) {
    const { controller, engine, selection } = await fixture(settings);
    try {
      assert.equal(controller.view.can_play, false);
      assert.ok(controller.view.message.match(/Missing music|GPU preparation/));
      assert.equal(engine.session_handles.size, 0);
      assert.ok(selection.active);
      await controller.play();
      assert.equal(controller.view.in_attempt, false);
    } finally { controller.dispose(); controller.dispose(); }
  }
});

test('pause releases held actions, ignores paused input, freezes suspended audio, resumes once and reuses retry GPU', async () => {
  const fixture_ = await fixture();
  const { controller, engine, context, key, frame, callbacks, renderers, window } = fixture_;
  try {
    await controller.play(); await controller.play();
    assert.equal(callbacks.size, 1);
    key(500, true); frame(500);
    context.state = 'suspended';
    dispatch(context, 'statechange');
    assert.equal(controller.view.state, 'paused');
    assert.equal(callbacks.size, 0);
    const session = [...engine.session_handles][0];
    assert.equal(engine.snapshot(session, 500).summary.committed_ms, 500);
    key(700, true);
    controller.pause();
    context.currentTime = 1;
    await controller.resume(); await controller.resume();
    assert.equal(controller.view.state, 'running');
    assert.equal(callbacks.size, 1);
    dispatch(window, 'keydown', { code: 'Escape', repeat: false });
    assert.equal(controller.view.state, 'paused');
    await controller.retry();
    assert.equal(controller.view.state, 'running');
    assert.equal([...engine.session_handles][0], session);
    assert.equal(renderers.length, 1);
    assert.equal(callbacks.size, 1);
    controller.back();
    assert.equal(controller.view.in_attempt, false);
    assert.equal(callbacks.size, 0);
    assert.equal(engine.session_handles.size, 1);
    assert.ok(context.sources.every(source => source.disconnected));
  } finally { controller.dispose(); }
  assert.equal(callbacks.size, 0);
  assert.equal(engine.session_handles.size, 0);
});

test('Back and persisted pagehide invalidate pending starts; stale RAF and restoration cannot resurrect an attempt', async () => {
  const { controller, context, callbacks, window, canvas, frame } = await fixture();
  try {
    let resolve_resume;
    context.resume = () => new Promise(resolve => { resolve_resume = resolve; });
    const starting = controller.play();
    controller.back(); resolve_resume(); await starting;
    assert.equal(controller.view.in_attempt, false);
    assert.equal(callbacks.size, 0);
    const next_start = controller.play();
    dispatch(window, 'pagehide', { persisted: true });
    resolve_resume(); await next_start;
    assert.equal(controller.view.state, 'recovering');
    assert.equal(callbacks.size, 0);
    context.resume = async () => { context.state = 'running'; };
    await controller.retry();
    const stale = [...callbacks.values()][0];
    controller.back(); stale(); frame(100);
    dispatch(canvas, 'webglcontextrestored');
    controller.dispose(); await Promise.resolve();
    assert.equal(controller.view.state, 'disposed');
    assert.equal(callbacks.size, 0);
  } finally { controller.dispose(); }
});

test('GPU loss and focus loss share a clean pause; restoration never auto-resumes', async () => {
  const { controller, renderers, canvas, window, callbacks } = await fixture();
  try {
    await controller.play();
    renderers[0].ready = false; renderers[0].lost();
    dispatch(window, 'blur');
    assert.equal(controller.view.state, 'paused');
    assert.equal(controller.view.can_resume, false);
    await controller.resume(); assert.equal(callbacks.size, 0);
    dispatch(canvas, 'webglcontextrestored'); await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(controller.view.can_resume, true);
    assert.equal(callbacks.size, 0);
    await controller.resume(); assert.equal(callbacks.size, 1);
  } finally { controller.dispose(); }
});

test('rejected input and dispatch failure require Retry; diagnostics retain the rejected batch', async () => {
  for (const failure of ['input', 'audio']) {
    const { controller, engine, context, key, frame, callbacks } = await fixture();
    try {
      await controller.play();
      if (failure === 'input') { frame(900); key(100, true); }
      else { context.createBufferSource = () => { throw new Error('dispatch failure'); }; key(1000, true); }
      frame(1000);
      assert.equal(controller.view.state, 'recovering');
      assert.equal(controller.view.can_resume, false);
      assert.equal(callbacks.size, 0);
      assert.ok(controller.view.error);
      assert.equal(engine.session_handles.size, 1);
    } finally { controller.dispose(); }
  }
});

// Regression for the two-clock failure: an extrapolated performance.now()
// receipt used to map this input before the committed boundary and reject it.
// With one audio clock the handler samples the already-committed block, the
// stamp equals the committed boundary, and the input is admitted.
test('input handled after its block committed is judged at the audio boundary, not rejected', async () => {
  let expected;
  for (const integrated of [false, true]) {
    const { controller, engine, frame, key } = await fixture();
    try {
      const session = [...engine.session_handles][0];
      if (!integrated) {
        engine.submit_inputs(session, [{ sequence: 1n, raw_time_ms: 1002, effective_time_ms: 1002,
          x: 256, y: 192, action_bits: 1 }]);
        engine.advance_output(session, 5000, new Gameplay_Output());
        expected = engine.result(session).bytes;
      } else {
        await controller.play();
        frame(1002);
        key(1002, true);
        frame(1010);
        assert.equal(controller.view.state, 'running');
        frame(5000);
        assert.equal(controller.view.state, 'terminal');
        assert.deepEqual(controller.view.result.bytes, expected);
      }
    } finally { controller.dispose(); }
  }
});

test('pre-anchor audio stamps fail visibly with retained input evidence', async () => {
  const { controller, context, key, frame } = await fixture();
  try {
    context.currentTime = 10;
    await controller.play();
    key(9990, true);
    frame(10010);
    assert.equal(controller.view.state, 'recovering');
    assert.equal(controller.view.error.code, 'INVALID_CLOCK');
    assert.equal(controller.view.recovery.error_code, 'INVALID_CLOCK');
    assert.equal(controller.view.recovery.pending_input_preview[0].audio_seconds, 9.99);
    assert.equal(controller.view.recovery.pending_input_count, 1);
  } finally { controller.dispose(); }
});

test('genuinely late audio stamps reject as engine late input with retained evidence', async () => {
  const { controller, frame } = await fixture();
  try {
    await controller.play();
    frame(900);
    controller.frame.input.receive({ source_id: 'KeyZ', action: 1, held: true,
      audio_seconds: 0.1, clock_epoch: controller.playback.clock.epoch });
    frame(1000);
    assert.equal(controller.view.state, 'recovering');
    assert.equal(controller.view.error.code, 'ENGINE_7');
    assert.equal(controller.view.recovery.pending_input_preview[0].audio_seconds, 0.1);
    assert.equal(controller.view.recovery.pending_input_count, 1);
  } finally { controller.dispose(); }
});

test('production controller mixed final results match headless at direct/rate/stall schedules', async () => {
  let expected;
  for (const rate of [0, 30, 60, 120, 144]) {
    for (const stall of [0, 50, 100, 250]) {
      const { controller, engine, frame, key } = await fixture();
      try {
        const session = [...engine.session_handles][0];
        const inputs = [[1000, true], [1100, false], [2000, true], [2100, false]];
        if (rate === 0) {
          engine.submit_inputs(session, inputs.map(([time_ms, held], event_index) => ({ sequence: BigInt(event_index + 1),
            raw_time_ms: time_ms, effective_time_ms: time_ms, x: 256, y: 192, action_bits: held ? 1 : 0 })));
          engine.advance_output(session, 5000, new Gameplay_Output());
          expected ??= engine.result(session).bytes;
        } else {
          await controller.play();
          let event_index = 0;
          for (let frame_index = 1; frame_index <= rate * 5; frame_index++) {
            const time_ms = frame_index * 1000 / rate;
            if (time_ms > 1950 && time_ms < 1950 + stall) continue;
            while (event_index < inputs.length && inputs[event_index][0] <= time_ms) key(...inputs[event_index++]);
            frame(time_ms);
          }
          assert.equal(controller.view.state, 'terminal');
          assert.deepEqual(controller.view.result.bytes, expected, `${rate} Hz / ${stall} ms`);
        }
      } finally { controller.dispose(); }
    }
  }
});

test('terminal success drains sounds then stops; failure and Back cancel immediately', async () => {
  const { controller, frame, context, callbacks } = await fixture();
  try {
    await controller.play(); frame(5000);
    assert.equal(controller.view.state, 'terminal');
    for (const source of context.sources) source.onended?.();
    frame(5100);
    assert.equal(callbacks.size, 0);
    assert.equal(controller.view.result.summary.state, 3);
    controller.back(); assert.equal(controller.view.result, null);
  } finally { controller.dispose(); }
  const failing = await fixture({ map_text: mixed_map.replace('HPDrainRate:0', 'HPDrainRate:10') });
  try {
    await failing.controller.play(); failing.frame(10000);
    assert.equal(failing.controller.view.result.summary.state, 4);
    assert.equal(failing.callbacks.size, 0);
    assert.ok(failing.context.sources.every(source => source.disconnected));
  } finally { failing.controller.dispose(); }
});

test('incomplete capabilities block preparation; retry/back retain bounded ownership over twenty attempts', async () => {
  const { controller, engine, context, callbacks, selection } = await fixture();
  try {
    const mask = engine.transport_capabilities.voice_command_mask;
    engine.transport_capabilities.voice_command_mask = 1;
    controller.back();
    assert.equal(controller.view.can_play, false);
    assert.equal(engine.session_handles.size, 0);
    assert.ok(selection.active);
    engine.transport_capabilities.voice_command_mask = mask;
    engine.simulation_capabilities.flags = 0;
    controller.back();
    assert.equal(controller.view.can_play, false);
    engine.simulation_capabilities.flags = 1;
    controller.back();
    await controller.play();
    const pages = engine.wasm.memory.buffer.byteLength;
    const retained_map = selection.active.map_handle;
    for (let attempt_index = 0; attempt_index < 20; attempt_index++) {
      controller.pause();
      await controller.retry();
      assert.equal(controller.view.state, 'running');
      assert.equal(engine.session_handles.size, 1);
      assert.equal(engine.map_handles.size, 1);
      assert.equal(callbacks.size, 1);
      assert.equal(selection.active.map_handle, retained_map);
      assert.equal(engine.wasm.memory.buffer.byteLength, pages);
      assert.equal(context.sources.filter(source => !source.disconnected).length, 1);
    }
  } finally { controller.dispose(); }
});

test('an audio gesture rejection is actionable and a later retry can start', async () => {
  const { controller, context, callbacks } = await fixture();
  try {
    context.resume = async () => { throw new Error('Audio permission denied'); };
    await controller.play();
    assert.equal(controller.view.state, 'recovering');
    assert.match(controller.view.message, /Audio permission denied/);
    assert.equal(callbacks.size, 0);
    context.resume = async () => { context.state = 'running'; };
    await controller.retry();
    assert.equal(controller.view.state, 'running');
  } finally { controller.dispose(); }
});

test('early slider tail keeps its nominal time; active sound survives results until visibility cancellation', async () => {
  const { controller, engine, frame, context, callbacks, document } = await fixture({ map_text:
    'osu file format v14\n[Difficulty]\nHPDrainRate:0\nSliderMultiplier:1.4\n[TimingPoints]\n0,500\n[HitObjects]\n256,192,1000,2,0,L|396:192,1,140' });
  try {
    await controller.play();
    const session = [...engine.session_handles][0];
    engine.submit_inputs(session, [
      { sequence: 1n, raw_time_ms: 1000, effective_time_ms: 1000, x: 256, y: 192, action_bits: 1 },
      { sequence: 2n, raw_time_ms: 1464, effective_time_ms: 1464, x: 396, y: 192, action_bits: 1 },
    ]);
    frame(1464);
    assert.equal(controller.view.state, 'running');
    assert.ok(!context.calls.some(call => call[0] === 'start' && call[1] === 1.5));
    frame(1500);
    assert.equal(controller.view.state, 'terminal');
    assert.equal(controller.view.result.summary.state, 3);
    assert.equal(callbacks.size, 1);
    const snapshot = controller.view.result.bytes.slice();
    frame(1510);
    assert.deepEqual(controller.view.result.bytes, snapshot);
    assert.ok(context.calls.some(call => call[0] === 'start' && call[1] === 1.5));
    document.hidden = true; dispatch(document, 'visibilitychange');
    assert.equal(callbacks.size, 0);
    assert.ok(context.sources.every(source => source.disconnected));
  } finally { controller.dispose(); }
});

test('controller pause at a scheduled slider boundary matches direct engine release ordering', async () => {
  const map_text = 'osu file format v14\n[Difficulty]\nHPDrainRate:0\nSliderMultiplier:1.4\n[TimingPoints]\n0,500\n[HitObjects]\n256,192,1000,2,0,L|396:192,2,140\n256,192,3000,1,0';
  let expected;
  for (const integrated of [false, true]) {
    const { controller, context, engine } = await fixture({ map_text });
    try {
      await controller.play();
      const session = [...engine.session_handles][0];
      engine.submit_inputs(session, [
        { sequence: 1n, raw_time_ms: 1000, effective_time_ms: 1000, x: 256, y: 192, action_bits: 1 },
        { sequence: 2n, raw_time_ms: 1499, effective_time_ms: 1499, x: 396, y: 192, action_bits: 1 },
        { sequence: 3n, raw_time_ms: 1800, effective_time_ms: 1800, x: 312, y: 192, action_bits: 1 },
      ]);
      context.currentTime = 1.5;
      if (integrated) controller.pause(); else engine.pause(session, 1500);
      const paused = engine.snapshot(session, 1500);
      const observations = {
        state: paused.summary.state, committed_ms: paused.summary.committed_ms,
        judgements: Array.from({ length: paused.spans.get('judgements').count }, (_, judgement_index) => paused.record('judgements', judgement_index)),
      };
      if (!integrated) expected = observations; else assert.deepEqual(observations, expected);
      assert.equal(observations.state, 2);
      if (integrated) await controller.resume(); else engine.resume(session, { beatmap_ms: 1500, audio_seconds: 1.5 });
      const later = engine.advance(session, 1800);
      assert.equal(later.summary.committed_ms, 1800);
    } finally { controller.dispose(); }
  }
});
