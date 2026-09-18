import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Engine_Bridge } from '../build/engine-bridge.js';
import { mapped_sources, Resume_Gate } from '../build/resume-gate.js';
import { DEFAULT_PLAYER_SETTINGS } from '../build/player-settings.js';

const wasm = await readFile(new URL('../../../engine/artifacts/tapweave.wasm', import.meta.url));
const map_text = `osu file format v14
[Difficulty]
HPDrainRate:0
[Events]
2,7000,9000
[HitObjects]
256,192,3000,1,0
256,192,6000,1,0
256,192,11000,1,0
256,192,16000,1,0`;

// Same held-key and hit-circle assertions as the pinned TestScenePauseInputHandling
// cases; engine/tests/resume_test.odin covers the native engine path.
test('WASM resume consumes a press without losing its held action; replay and seek reproduce it', async () => {
  for (const paused_actions of [0, 1, 2]) {
    const engine = await Engine_Bridge.create(wasm);
    try {
      const map = engine.prepare_map(new TextEncoder().encode(map_text));
      const session = engine.create_session(map.map_handle);
      let sequence = 0n;
      const submit = (time, action_bits, flags = 0) => engine.submit_inputs(session, [{ sequence: ++sequence,
        raw_time_ms: time, effective_time_ms: time, x: 256, y: 192, action_bits, flags }]);
      const pause_ms = paused_actions ? 6000 : 3000;
      submit(3000, paused_actions);
      engine.pause(session, pause_ms);
      const policy = engine.resume_policy(session, 3);
      assert.equal(policy.held_action_bits, paused_actions);
      assert.equal(policy.left_input_flags, paused_actions & 1 ? 0 : 1);
      assert.equal(policy.right_input_flags, paused_actions & 2 ? 0 : 1);
      const prior_combo = engine.snapshot(session, pause_ms).summary.highest_combo;
      assert.throws(() => submit(pause_ms, 1), /./);
      engine.resume(session, { beatmap_ms: pause_ms, audio_seconds: 10 });
      submit(pause_ms, 1, paused_actions === 1 ? 0 : 1);
      assert.equal(engine.advance(session, pause_ms).summary.highest_combo, prior_combo);
      engine.pause(session, pause_ms);
      assert.equal(engine.resume_policy(session, 3).held_action_bits, 1);
      engine.resume(session, { beatmap_ms: pause_ms, audio_seconds: 11 });
      submit(pause_ms, 0); submit(pause_ms, 1);
      assert.equal(engine.advance(session, pause_ms).summary.highest_combo, Number(prior_combo) + 1);
      engine.advance(session, 17000);
      const final = engine.result(session).bytes;
      const replay = engine.export_replay(session);
      assert.equal(new DataView(replay.buffer, replay.byteOffset).getUint32(20, true), 2);
      engine.reset_session(session);
      engine.load_replay(session, replay);
      for (const target of [pause_ms, 17000, 0, 17000]) engine.seek_replay(session, target);
      assert.deepEqual(engine.result(session).bytes, final);
    } finally { engine.dispose(); }
  }
});

test('resume gate policy uses exact intro/break boundaries and validates cursor flags', async () => {
  const engine = await Engine_Bridge.create(wasm);
  try {
    const map = engine.prepare_map(new TextEncoder().encode(map_text));
    const session = engine.create_session(map.map_handle);
    for (const [time, required] of [[999, 0], [1000, 1], [7000, 0], [8675, 0], [8675.001, 1]]) {
      engine.reset_session(session);
      engine.pause(session, time);
      assert.equal(engine.resume_policy(session, 3).required, required);
      for (const flags of [0, 1, 2]) assert.equal(engine.resume_policy(session, flags).required, 0);
      assert.throws(() => engine.resume_policy(session, 4), /./);
      assert.equal(engine.resume_policy(session, 3).required, required);
    }
  } finally { engine.dispose(); }
});

test('physical source restoration preserves aggregation and excludes modifier chords', () => {
  assert.deepEqual([...mapped_sources(new Set(['KeyZ', 'mouse:0', 'KeyX']), DEFAULT_PLAYER_SETTINGS)],
    [['KeyZ', 1], ['mouse:0', 1], ['KeyX', 2]]);
  assert.deepEqual([...mapped_sources(new Set(['ControlLeft', 'KeyZ', 'mouse:0']), DEFAULT_PLAYER_SETTINGS)], [['mouse:0', 1]]);
  assert.deepEqual([...mapped_sources(new Set(['KeyZ', 'mouse:0', 'Space']),
    { ...DEFAULT_PLAYER_SETTINGS, left_key: 'Space', mouse_buttons_enabled: false })], [['Space', 1]]);
});

test('cursor gate ignores off-target and repeated/duplicate-source actions, and cleans up', () => {
  const nodes = new Set();
  const window = new EventTarget();
  const document = Object.assign(new EventTarget(), { defaultView: window, body: { append: node => nodes.add(node) },
    createElement: () => { const node = { style: {}, setAttribute() {}, remove() { nodes.delete(node); } }; return node; } });
  const canvas = Object.assign(new EventTarget(), { ownerDocument: document, focus() {}, getBoundingClientRect: () => ({ top: 0 }) });
  const accepted = [];
  let cancelled = 0;
  const gate = new Resume_Gate(canvas, DEFAULT_PLAYER_SETTINGS, 100, 100, 14, 0, 0, new Set(),
    action => accepted.push(action), () => cancelled++);
  const dispatch = (surface, type, fields) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, fields);
    Object.defineProperty(event, 'target', { value: canvas });
    surface.dispatchEvent(event);
  };
  dispatch(window, 'keydown', { code: 'KeyZ' });
  assert.deepEqual(accepted, []);
  dispatch(window, 'pointermove', { pointerType: 'mouse', clientX: 114, clientY: 114, buttons: 0 });
  dispatch(window, 'keydown', { code: 'KeyZ', repeat: true });
  dispatch(canvas, 'pointerdown', { pointerType: 'mouse', button: 0, clientX: 100, clientY: 100 });
  assert.deepEqual(accepted, []);
  dispatch(window, 'keyup', { code: 'KeyZ' });
  dispatch(window, 'pointerup', { button: 0 });
  dispatch(window, 'keydown', { code: 'KeyX' });
  assert.deepEqual(accepted, [2]);
  dispatch(window, 'keydown', { code: 'Escape' });
  assert.equal(cancelled, 1);
  gate.dispose();
  assert.equal(nodes.size, 0);
  dispatch(window, 'keydown', { code: 'Escape' });
  assert.equal(cancelled, 1);
});

// The browser's fullscreen-exit Escape must not also cancel the gate,
// whichever order the engine delivers the exit event and the keydown in.
test('cursor gate leaves the fullscreen-exit Escape to the browser across delivery orders', () => {
  const nodes = new Set();
  const window = new EventTarget();
  const document = Object.assign(new EventTarget(), { defaultView: window, body: { append: node => nodes.add(node) },
    createElement: () => { const node = { style: {}, setAttribute() {}, remove() { nodes.delete(node); } }; return node; } });
  const canvas = Object.assign(new EventTarget(), { ownerDocument: document, focus() {}, getBoundingClientRect: () => ({ top: 0 }) });
  let cancelled = 0;
  const gate = new Resume_Gate(canvas, DEFAULT_PLAYER_SETTINGS, 100, 100, 14, 0, 0, new Set(),
    () => {}, () => cancelled++);
  const dispatch_keydown = () => {
    const event = new Event('keydown', { cancelable: true });
    Object.assign(event, { code: 'Escape' });
    Object.defineProperty(event, 'target', { value: canvas });
    window.dispatchEvent(event);
  };
  // Still fullscreen: the browser owns the Escape outright.
  document.fullscreenElement = canvas;
  dispatch_keydown();
  assert.equal(cancelled, 0);
  // Exit-first engines deliver the keydown after the exit event; the grace
  // window still owns it.
  document.fullscreenElement = null;
  document.dispatchEvent(new Event('fullscreenchange'));
  dispatch_keydown();
  assert.equal(cancelled, 0);
  // Past the grace window the windowed Escape cancels the gate again.
  const original_now = performance.now.bind(performance);
  const exit_now = original_now();
  document.dispatchEvent(new Event('fullscreenchange'));
  performance.now = () => exit_now + 10_000;
  dispatch_keydown();
  assert.equal(cancelled, 1);
  performance.now = original_now;
  gate.dispose();
});
