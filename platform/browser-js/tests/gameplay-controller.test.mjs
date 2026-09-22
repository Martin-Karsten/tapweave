import { createHash } from 'node:crypto';
import { Audio_Mixer } from '../build/audio-mixer.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Engine_Bridge, Gameplay_Output } from '../build/engine-bridge.js';
import { Gameplay_Controller } from '../build/gameplay-controller.js';
import { Selection_Controller } from '../build/selection.js';
import { create_fallback_audio } from '../build/fallback-audio.js';
import { load_sample_assets } from '../build/sample-assets.js';
import { DEFAULT_PLAYER_SETTINGS } from '../build/player-settings.js';
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

async function fixture({ map_text = mixed_map, renderer_failure = false, music = true, input_settings, outputs, mixer_settings } = {}) {
  const engine = await Engine_Bridge.create(wasm);
  const context = Object.assign(new EventTarget(), audio_context_fixture());
  context.currentTime = 0;
  const mixer = mixer_settings ? new Audio_Mixer(context, mixer_settings) : null;
  if (mixer) outputs = { music: mixer.music, effects: mixer.effects };
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
  selection.active = { ...map, set_id: 1, source, filename: 'map.osu', music_buffer: music ? { duration: 10 } : null,
    samples, music_status: music ? 'decoded' : 'missing', music_error: music ? null : 'Missing music.' };
  selection.state = 'prepared';
  const callbacks = new Map();
  const renderers = [];
  const views = [];
  let next_identifier = 0;
  const controller = new Gameplay_Controller(engine, selection, context, canvas, {
    input_settings, outputs,
    request_frame: callback => { callbacks.set(++next_identifier, callback); return next_identifier; },
    cancel_frame: identifier => callbacks.delete(identifier),
    create_renderer(engine, session, map, canvas, epoch, lost) {
      if (renderer_failure) throw new Error('GPU preparation failed');
      // The real Renderer constructor publishes the map's scene attachment;
      // the session-aware input transform and scene draws depend on it.
      engine.scene_resources(map);
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
  return { engine, context, window, document, canvas, selection, controller, callbacks, renderers, views, frame, key, mixer };
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

test('pause retains held actions, ignores paused input, freezes suspended audio, resumes once and reuses retry GPU', async () => {
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

test('controller pause at a scheduled slider boundary matches direct engine retained-action ordering', async () => {
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

// Local transport regression: deliberately offset receipt and audio timelines.
// Local transport regression: an audio stamp landing 2 ms behind the committed
// boundary is rejected with full, frozen timing evidence.
test('late keyboard input exposes frozen copyable timing evidence before recovery clears the clock', async () => {
  const fixture_ = await fixture();
  try {
    await fixture_.controller.play();
    fixture_.frame(1002);
    fixture_.key(1000, true);
    fixture_.frame(1010);
    const view = fixture_.controller.view;
    assert.equal(view.state, 'recovering');
    assert.equal(view.recovery.error_code, 'ENGINE_7');
    const details = view.recovery.error_details;
    assert.equal(details.operation, 'oe_session_inputs_from_reserved');
    assert.equal(details.status_name, 'LATE_INPUT');
    assert.equal(details.last_committed_ms, 1002);
    assert.equal(details.input_samples[0].receipt.audio_seconds, 1);
    assert.equal(details.input_samples[0].receipt.clock_epoch,
      details.clock_mapping.browser_epoch);
    assert.ok(Number.isFinite(details.input_samples[0].receipt.raw_time_ms));
    assert.equal(details.input_samples[0].mapped.effective_time_ms, 1000);
    assert.equal(details.input_samples[0].behind_committed_ms, 2);
    assert.ok(details.clock_mapping);
    assert.match(view.recovery.error_stack, /submit_inputs/);
    assert.doesNotThrow(() => JSON.stringify(view.recovery, (_field_name, field_value) =>
      typeof field_value === 'bigint' ? field_value.toString() : field_value));
    fixture_.controller.recover(new Error('Secondary recovery'));
    assert.equal(fixture_.controller.view.recovery, view.recovery);
    await fixture_.controller.retry();
    assert.equal(fixture_.controller.view.recovery, null);
    assert.equal(details.input_samples[0].behind_committed_ms, 2);
  } finally { fixture_.controller.dispose(); }
});

test('settings capture quarantines binding keys until release and survives repeated retry', async () => {
  let settings = DEFAULT_PLAYER_SETTINGS;
  const player = await fixture({ input_settings: () => settings });
  const { controller, engine, window, context, frame } = player;
  try {
    await controller.play();
    player.key(300, true); frame(300);
    controller.pause();
    settings = { ...DEFAULT_PLAYER_SETTINGS, left_key: 'Space', mouse_buttons_enabled: false };
    dispatch(window, 'keydown', { code: 'Space', repeat: false });
    controller.quarantine_input('Space');
    const session = [...engine.session_handles][0];
    context.currentTime = .5;
    await controller.resume();
    assert.equal(controller.view.message, 'Space / X · Escape to pause');
    dispatch(window, 'keydown', { code: 'Space', repeat: true });
    frame(510);
    assert.equal(controller.frame.input.held_sources.size, 0);
    dispatch(window, 'keyup', { code: 'Space' });
    dispatch(window, 'keydown', { code: 'Space', repeat: false });
    frame(520);
    assert.equal(controller.frame.input.held_sources.get('Space'), 1);
    dispatch(window, 'keyup', { code: 'Space' });
    for (let retry_index = 0; retry_index < 10; retry_index++) {
      await controller.retry();
      assert.equal(controller.view.message, 'Space / X · Escape to pause');
      assert.equal(engine.session_handles.size, 1);
      assert.equal(player.callbacks.size, 1);
    }
  } finally { controller.dispose(); }
});

test('custom keys and muted output retain result and audio-intent digests across cadence/stalls', async () => {
  let expected_digest;
  for (const custom of [false, true]) {
    const settings = custom ? { ...DEFAULT_PLAYER_SETTINGS, left_key: 'Space', right_key: 'ArrowRight',
      mouse_buttons_enabled: false, music_volume: 0, effects_volume: 0 } : DEFAULT_PLAYER_SETTINGS;
    for (const rate of [30, 60, 120, 144]) {
      for (const stall of [0, 50, 100, 250]) {
        const player = await fixture({ input_settings: () => settings, mixer_settings: settings });
        try {
          const intent = [];
          const audio = player.controller.playback.audio;
          const enqueue = audio.enqueue.bind(audio);
          audio.enqueue = events => { intent.push(...structuredClone(events)); enqueue(events); };
          await player.controller.play();
          assert.equal(player.context.sources[0].destination, player.mixer.music);
          assert.equal(audio.destination, player.mixer.effects);
          const inputs = [[1000, true], [1100, false], [2000, true], [2100, false]];
          let input_index = 0;
          for (let frame_index = 1; frame_index <= rate * 5; frame_index++) {
            const time_ms = frame_index * 1000 / rate;
            if (time_ms > 1950 && time_ms < 1950 + stall) continue;
            while (input_index < inputs.length && inputs[input_index][0] <= time_ms) {
              const [input_time, pressed] = inputs[input_index++];
              player.context.currentTime = input_time / 1000;
              dispatch(player.window, pressed ? 'keydown' : 'keyup', { code: settings.left_key, repeat: false });
            }
            player.frame(time_ms);
          }
          assert.equal(player.controller.view.state, 'terminal');
          const digest = createHash('sha256').update(player.controller.view.result.bytes)
            .update(JSON.stringify(intent, (_field, entry) => typeof entry === 'bigint' ? entry.toString() : entry)).digest('hex');
          expected_digest ??= digest;
          assert.equal(digest, expected_digest, `${custom ? 'custom/muted' : 'default'} / ${rate} Hz / ${stall} ms`);
        } finally { player.controller.dispose(); player.mixer.dispose(); }
      }
    }
  }
});

test('suspended audio observed before statechange requests ordinary pause at the audio boundary', async () => {
  const player = await fixture();
  try {
    await player.controller.play();
    player.key(300, true); player.frame(300);
    player.context.state = 'suspended';
    player.frame(350); // Deliberately before the browser's queued statechange.
    assert.equal(player.controller.view.state, 'paused');
    assert.equal(player.controller.view.error, null);
    assert.equal(player.controller.frame.input.held_sources.size, 0);
    const session = [...player.engine.session_handles][0];
    assert.equal(player.engine.snapshot(session, 350).summary.committed_ms, 350);
    dispatch(player.context, 'statechange');
    assert.equal(player.controller.view.state, 'paused');
    assert.equal(player.callbacks.size, 0);
    await player.controller.resume();
    assert.equal(player.controller.view.state, 'running');
  } finally { player.controller.dispose(); }
});

// Controller-level replay flow over the engine round-trip (engine.test.mjs):
// export after a live terminal run, refuse typed without a finished run,
// watch the frames back without any live input to a byte-identical result,
// retry the watch, and exit mid-watch back to the retained completed run on a
// fresh live session whose save/watch actions keep working.
test('watch replay reproduces the terminal result without input and exits to a fresh live session', async () => {
  const player = await fixture();
  try {
    assert.throws(() => player.controller.export_replay(), { code: 'INVALID_STATE' });
    await assert.rejects(() => player.controller.watch_replay(), { code: 'INVALID_STATE' });
    assert.throws(() => player.controller.stop_watch(), { code: 'INVALID_STATE' });
    await player.controller.play();
    for (const [time_ms, held] of [[1000, true], [1100, false], [2000, true], [2100, false]]) player.key(time_ms, held);
    player.frame(5000);
    assert.equal(player.controller.view.state, 'terminal');
    const live_result_bytes = player.controller.view.result.bytes.slice();
    const live_session = [...player.engine.session_handles][0];
    const first_export = player.controller.export_replay();
    assert.ok(first_export.length > 224);
    await player.controller.watch_replay();
    const watch_view = player.controller.view;
    assert.equal(watch_view.watching_replay, true);
    assert.equal(watch_view.state, 'running');
    // The completed run stays retained while its replay plays.
    assert.deepEqual(watch_view.result.bytes, live_result_bytes);
    assert.equal(watch_view.can_play, false);
    assert.equal(watch_view.can_resume, false);
    // Watch playback is non-interactive: pause/play/resume cannot act.
    player.controller.pause();
    await player.controller.play();
    await player.controller.resume();
    assert.equal(player.controller.view.state, 'running');
    assert.equal(player.controller.view.watching_replay, true);
    // Stray keys during the watch never reach the engine (no input surface).
    dispatch(player.window, 'keydown', { code: 'KeyZ', repeat: false });
    dispatch(player.window, 'keyup', { code: 'KeyZ' });
    for (let frame_time = 6000; frame_time <= 10000; frame_time += 1000) player.frame(frame_time);
    assert.equal(player.controller.view.state, 'terminal');
    assert.deepEqual(player.controller.view.result.bytes, live_result_bytes);
    // Natural watch completion keeps serving the retained recording.
    assert.deepEqual(player.controller.export_replay(), first_export);
    // Retry from the watch re-runs the retained bytes to the same result.
    await player.controller.retry();
    assert.equal(player.controller.view.watching_replay, true);
    assert.equal(player.controller.view.state, 'running');
    player.frame(16000);
    assert.equal(player.controller.view.state, 'terminal');
    assert.deepEqual(player.controller.view.result.bytes, live_result_bytes);
    // Escape-analog: stop mid-watch restores the retained completed run on a
    // fresh live session that can be played again after Back.
    await player.controller.retry();
    player.frame(17000);
    assert.equal(player.controller.view.state, 'running');
    player.controller.stop_watch();
    const restored_view = player.controller.view;
    assert.equal(restored_view.watching_replay, false);
    assert.equal(restored_view.state, 'terminal');
    assert.deepEqual(restored_view.result.bytes, live_result_bytes);
    assert.equal(restored_view.can_watch_replay, true);
    assert.notEqual([...player.engine.session_handles][0], live_session);
    assert.equal(player.engine.session_handles.size, 1);
    // The restored context serves Save and Watch from the retained recording
    // even though the active session is a fresh READY one.
    assert.deepEqual(player.controller.export_replay(), first_export);
    await player.controller.watch_replay();
    assert.equal(player.controller.view.watching_replay, true);
    assert.equal(player.controller.view.state, 'running');
    for (let frame_time = 18000; frame_time <= 22000; frame_time += 1000) player.frame(frame_time);
    assert.equal(player.controller.view.state, 'terminal');
    assert.deepEqual(player.controller.view.result.bytes, live_result_bytes);
    player.controller.stop_watch();
    assert.equal(player.controller.view.state, 'terminal');
    assert.deepEqual(player.controller.view.result.bytes, live_result_bytes);
    player.controller.back();
    assert.equal(player.controller.view.state, 'ready');
    assert.equal(player.controller.view.result, null);
    await player.controller.play();
    assert.equal(player.controller.view.state, 'running');
  } finally { player.controller.dispose(); }
});

// A watch whose playback start fails recovers without losing the completed
// run: Retry re-runs the retained bytes, and stop_watch still returns to the
// original results context.
test('interrupted watch startup recovers and keeps the completed run re-watchable', async () => {
  const player = await fixture();
  try {
    await player.controller.play();
    player.key(1000, true);
    player.frame(1010);
    player.frame(5000);
    assert.equal(player.controller.view.state, 'terminal');
    const live_result_bytes = player.controller.view.result.bytes.slice();
    const original_resume = player.context.resume;
    player.context.resume = async () => { throw new Error('Audio permission denied'); };
    await player.controller.watch_replay();
    const interrupted_view = player.controller.view;
    assert.equal(interrupted_view.state, 'recovering');
    assert.equal(interrupted_view.watching_replay, true);
    assert.match(interrupted_view.message, /Audio permission denied/);
    assert.deepEqual(interrupted_view.result.bytes, live_result_bytes);
    player.context.resume = original_resume;
    await player.controller.retry();
    assert.equal(player.controller.view.watching_replay, true);
    assert.equal(player.controller.view.state, 'running');
    for (let frame_time = 6000; frame_time <= 11000; frame_time += 1000) player.frame(frame_time);
    assert.equal(player.controller.view.state, 'terminal');
    assert.deepEqual(player.controller.view.result.bytes, live_result_bytes);
    player.controller.stop_watch();
    assert.equal(player.controller.view.state, 'terminal');
    assert.deepEqual(player.controller.view.result.bytes, live_result_bytes);
    assert.equal(player.controller.view.can_watch_replay, true);
  } finally { player.controller.dispose(); }
});

test('default session completes 65,000 audio-stamped cursor moves and watches the retained replay', async () => {
  const map_text = `osu file format v14
[Difficulty]
HPDrainRate:0
[HitObjects]
256,192,550000,1,0`;
  const { controller, context, window, frame, engine } = await fixture({ map_text });
  try {
    await controller.play();
    assert.equal(controller.view.state, 'running');
    const memory_bytes = engine.wasm.memory.buffer.byteLength;
    for (let input_index = 0; input_index < 65_000; input_index++) {
      const time_ms = input_index * 8;
      context.currentTime = time_ms / 1000;
      dispatch(window, 'pointermove', { pointerType: 'mouse', pointerId: 1, button: -1,
        buttons: 0, clientX: 100 + input_index % 400, clientY: 240 });
      if (input_index % 8 === 7) frame(time_ms);
    }
    frame(551000);
    assert.equal(controller.view.state, 'terminal');
    assert.equal(controller.view.error, null);
    assert.equal(engine.wasm.memory.buffer.byteLength, memory_bytes);
    const completed_result = controller.view.result;
    await controller.watch_replay();
    frame(1102000);
    assert.equal(controller.view.state, 'terminal');
    assert.deepEqual(controller.view.result, completed_result);
  } finally { controller.dispose(); }
});

// Skip-window coverage (shell-lazer-parity plan Phase B), porting the pinned
// osu!lazer intent at 3c1c96f742e7aae2ff67a7361e058fe91ca3b955:
// MasterGameplayClockContainer.MINIMUM_SKIP_TIME = 1000 and SkipOverlay's
// expiry/no-window cases (TestSceneSkipOverlay TestSkipTimeZero,
// TestSkipTimeEqualToSkip, TestClickOnlyActuatesOnce).
const lead_in_map = `osu file format v14
[Difficulty]
HPDrainRate:0
[TimingPoints]
0,500
[HitObjects]
256,192,10000,1,0`;
const equal_lead_map = lead_in_map.replace('10000', '1000');
const break_map = `osu file format v14
[Difficulty]
HPDrainRate:0
[TimingPoints]
0,500
[Events]
2,1500,5000
[HitObjects]
256,192,1000,1,0
256,192,6000,1,0`;

// After a skip the audio clock is re-anchored, so beatmap time no longer maps
// from audio zero. This driver advances the fixture relative to the running
// anchor instead of assuming context.currentTime == beatmap_ms / 1000.
function clock_relative_driver(player) {
  let origin_audio_seconds = 0;
  let origin_beatmap_ms = 0;
  const audio_at = (time_ms) => origin_audio_seconds + (time_ms - origin_beatmap_ms) / 1000;
  return {
    advance_to(time_ms) {
      player.context.currentTime = audio_at(time_ms);
      const scheduled = [...player.callbacks.values()];
      player.callbacks.clear();
      for (const callback of scheduled) callback(player.context.currentTime * 1000);
    },
    key_at(time_ms, held) {
      player.context.currentTime = audio_at(time_ms);
      dispatch(player.window, held ? 'keydown' : 'keyup', { code: 'KeyZ', repeat: false });
    },
    note_skip() {
      origin_audio_seconds = player.context.currentTime;
      origin_beatmap_ms = player.controller.playback_clock.anchor.beatmap_ms;
    },
  };
}

test('lead-in skip jumps the engine in one advance, actuates once and reproduces the straight-run result', async () => {
  let straight_result;
  for (const use_skip of [false, true]) {
    const player = await fixture({ map_text: lead_in_map });
    const { controller, engine } = player;
    const driver = clock_relative_driver(player);
    try {
      await controller.play();
      const session = [...engine.session_handles][0];
      assert.equal(controller.view.can_skip, true);
      driver.advance_to(500);
      // Stray input inside the skipped gap: same journal in both runs.
      driver.key_at(600, true); driver.key_at(650, false);
      if (use_skip) {
        controller.skip();
        driver.note_skip();
        assert.equal(controller.view.can_skip, false);
        assert.equal(controller.playback_clock.anchor.beatmap_ms, 9000);
        controller.skip();
        assert.equal(controller.playback_clock.anchor.beatmap_ms, 9000);
      } else {
        driver.advance_to(700);
      }
      driver.advance_to(9050);
      assert.ok(engine.snapshot(session, 9050).summary.committed_ms >= 9000);
      driver.key_at(10000, true); driver.key_at(10050, false);
      driver.advance_to(10100); driver.advance_to(11000);
      assert.equal(controller.view.state, 'terminal');
      assert.equal(Number(controller.view.result.summary.state), 3);
      if (straight_result === undefined) straight_result = controller.view.result.bytes;
      else assert.deepEqual(controller.view.result.bytes, straight_result);
    } finally { controller.dispose(); }
  }
});

test('break skip appears inside the break, lands one lead before its end and preserves the result', async () => {
  let straight_result;
  for (const use_skip of [false, true]) {
    const player = await fixture({ map_text: break_map });
    const { controller, engine } = player;
    const driver = clock_relative_driver(player);
    try {
      await controller.play();
      const session = [...engine.session_handles][0];
      assert.equal(controller.view.can_skip, false);
      driver.key_at(1000, true); driver.key_at(1050, false); driver.advance_to(1100);
      assert.equal(controller.view.can_skip, false);
      driver.advance_to(1600);
      assert.equal(controller.view.can_skip, true);
      if (use_skip) {
        controller.skip();
        driver.note_skip();
        assert.equal(controller.view.can_skip, false);
        assert.equal(controller.playback_clock.anchor.beatmap_ms, 4000);
      }
      driver.advance_to(4100);
      assert.ok(engine.snapshot(session, 4100).summary.committed_ms >= 4100);
      driver.key_at(6000, true); driver.key_at(6050, false);
      driver.advance_to(6100); driver.advance_to(7100);
      assert.equal(controller.view.state, 'terminal');
      if (straight_result === undefined) straight_result = controller.view.result.bytes;
      else assert.deepEqual(controller.view.result.bytes, straight_result);
    } finally { controller.dispose(); }
  }
});

test('skip is refused outside skippable windows and never disturbs the clock', async () => {
  for (const map_text of [equal_lead_map, lead_in_map]) {
    const player = await fixture({ map_text });
    const { controller, frame } = player;
    try {
      assert.equal(controller.view.can_skip, false);
      await controller.play();
      if (map_text === lead_in_map) {
        assert.equal(controller.view.can_skip, true);
        frame(9500);
      }
      assert.equal(controller.view.can_skip, false);
      const anchor_before = controller.playback_clock.anchor.beatmap_ms;
      const epoch_before = controller.playback_clock.epoch;
      controller.skip();
      assert.equal(controller.playback_clock.epoch, epoch_before);
      assert.equal(controller.playback_clock.anchor.beatmap_ms, anchor_before);
      controller.pause();
      assert.equal(controller.view.can_skip, false);
      controller.skip();
      assert.equal(controller.playback_clock.anchor, null);
    } finally { controller.dispose(); }
  }
});

test('input stamped with the closed clock epoch fails loudly after a skip', async () => {
  const player = await fixture({ map_text: lead_in_map });
  const { controller, key, frame } = player;
  try {
    await controller.play();
    const clock = controller.playback_clock;
    const closed_epoch = clock.epoch;
    frame(500);
    controller.skip();
    const running_epoch = clock.epoch;
    assert.notEqual(running_epoch, closed_epoch);
    clock.epoch = closed_epoch;
    key(9100, true);
    clock.epoch = running_epoch;
    frame(9150);
    assert.equal(controller.view.state, 'recovering');
  } finally { controller.dispose(); }
});
