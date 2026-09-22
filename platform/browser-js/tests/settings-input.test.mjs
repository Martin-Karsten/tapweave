import test from 'node:test';
import assert from 'node:assert/strict';
import { Gameplay_Input } from '../build/gameplay-input.js';
import { Input_Buffer } from '../build/input.js';
import { Held_Input } from '../build/held-input.js';
import { DEFAULT_PLAYER_SETTINGS } from '../build/player-settings.js';

function dispatch(target, type, fields = {}) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, fields);
  target.dispatchEvent(event);
}
function fixture(settings = DEFAULT_PLAYER_SETTINGS, held = new Set()) {
  const window = Object.assign(new EventTarget(), { devicePixelRatio: 1 });
  const document = Object.assign(new EventTarget(), { defaultView: window });
  const canvas = Object.assign(new EventTarget(), { ownerDocument: document, style: {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 512, height: 384 }), setPointerCapture() {} });
  let pauses = 0;
  const frame = { input: new Input_Buffer(), terminal: false,
    playback: { state: 'running', clock: { epoch: 7 }, session_handle: 5n, engine: { session_playfield_transform: () => ({
      inverse_a: 1, inverse_b: 0, inverse_c: 0, inverse_d: 1, inverse_e: 0, inverse_f: 0 }) } },
    fail(error) { throw error; } };
  const input = new Gameplay_Input(canvas, frame, () => 12.345, () => { pauses++; }, true, settings, held);
  const key = (code, pressed = true, fields = {}) => dispatch(window, pressed ? 'keydown' : 'keyup', { code, repeat: false, ...fields });
  const pointer = (type, fields = {}) => dispatch(type === 'pointerdown' ? canvas : window, type,
    { pointerType: 'mouse', pointerId: 1, button: 0, buttons: 0, clientX: 200, clientY: 100, ...fields });
  return { window, document, canvas, frame, input, key, pointer, pauses: () => pauses };
}

test('custom physical keys preserve aggregation, repeated-key suppression and equal audio stamps', () => {
  const settings = { ...DEFAULT_PLAYER_SETTINGS, left_key: 'ArrowLeft', right_key: 'Space' };
  const player = fixture(settings);
  settings.left_key = 'KeyA';
  player.key('KeyZ');
  player.key('ArrowLeft');
  player.key('ArrowLeft', true, { repeat: true });
  player.pointer('pointerdown', { buttons: 1 });
  player.key('ArrowLeft', false);
  player.pointer('pointerup');
  player.key('Space');
  assert.deepEqual(player.frame.input.records.map(record => record.action_bits), [1, 1, 1, 0, 2]);
  assert.ok(player.frame.input.records.every(record => record.audio_seconds === 12.345 && record.clock_epoch === 7));
  player.input.dispose();
});

test('held keys and buttons are suppressed until release; modifier chords do not hit', () => {
  const player = fixture(DEFAULT_PLAYER_SETTINGS, new Set(['KeyZ', 'mouse:0']));
  player.key('KeyZ');
  player.pointer('pointerdown', { buttons: 1 });
  assert.equal(player.frame.input.held_sources.size, 0);
  player.key('KeyZ', false);
  player.pointer('pointerup');
  for (const modifier of ['ctrlKey', 'altKey', 'metaKey', 'shiftKey']) {
    player.key('KeyX', true, { [modifier]: true });
  }
  assert.equal(player.frame.input.held_sources.size, 0);
  player.key('KeyZ');
  player.pointer('pointerdown', { buttons: 1 });
  assert.equal(player.frame.input.held_sources.size, 2);
  player.input.dispose();
});

test('disabled mouse hits retain aiming; focus and pointer cancellation still pause', () => {
  const player = fixture({ ...DEFAULT_PLAYER_SETTINGS, mouse_buttons_enabled: false });
  player.pointer('pointerdown', { buttons: 1 });
  player.pointer('pointermove', { buttons: 1, clientX: 300 });
  player.pointer('pointerup');
  assert.ok(player.frame.input.records.every(record => record.action_bits === 0));
  assert.equal(player.frame.input.records[1].x, 300);
  player.pointer('pointercancel');
  dispatch(player.window, 'blur');
  assert.equal(player.pauses(), 2);
  player.input.dispose();
  player.key('KeyX');
  assert.equal(player.frame.input.held_sources.size, 0);
});

// The browser's fullscreen-exit Escape must not also pause the run, whichever
// order the engine delivers the exit event and the keydown in: some engines
// exit fullscreen (and fire fullscreenchange) before the keydown arrives.
test('fullscreen exit owns the first Escape across engine delivery orders', () => {
  const player = fixture();
  // Still fullscreen: the browser owns the Escape outright.
  player.document.fullscreenElement = player.canvas;
  player.key('Escape');
  assert.equal(player.pauses(), 0);
  // Exit-first engines deliver the keydown after the exit event; the grace
  // window still owns it.
  player.document.fullscreenElement = null;
  dispatch(player.document, 'fullscreenchange');
  player.key('Escape');
  assert.equal(player.pauses(), 0);
  // Past the grace window the windowed Escape pauses again.
  const original_now = performance.now.bind(performance);
  const exit_now = original_now();
  dispatch(player.document, 'fullscreenchange');
  performance.now = () => exit_now + 10_000;
  player.key('Escape');
  assert.equal(player.pauses(), 1);
  performance.now = original_now;
  player.input.dispose();
});

test('page physical tracking clears unobservable keys on blur and disposes all observers', () => {
  const window = new EventTarget();
  const held = new Held_Input(window);
  dispatch(window, 'keydown', { code: 'KeyZ' });
  const element_blur = new Event('blur');
  Object.defineProperty(element_blur, 'target', { value: new EventTarget() });
  window.dispatchEvent(element_blur);
  assert.equal(held.sources.has('KeyZ'), true, 'menu/canvas focus changes preserve physical state');
  dispatch(window, 'blur');
  assert.equal(held.sources.has('KeyZ'), false);
  dispatch(window, 'keyup', { code: 'KeyZ' });
  dispatch(window, 'pointerdown', { pointerType: 'mouse', button: 2 });
  assert.deepEqual([...held.sources], ['mouse:2']);
  dispatch(window, 'pointermove', { pointerType: 'mouse', buttons: 0 });
  assert.equal(held.sources.size, 0);
  held.dispose();
  dispatch(window, 'keydown', { code: 'KeyX' });
  assert.equal(held.sources.size, 0);
});

test('chat releases held actions at audio time, suppresses typing and quarantines held sources', () => {
  const player = fixture();
  player.key('KeyZ');
  player.input.set_text_input_active(true, new Set(['KeyZ']));
  assert.equal(player.frame.input.records.at(-1).action_bits, 0);
  assert.equal(player.frame.input.records.at(-1).audio_seconds, 12.345);
  const record_count = player.frame.input.records.length;
  player.key('KeyZ', false);
  player.key('KeyX');
  player.key('Escape');
  player.pointer('pointerdown', { buttons: 1 });
  player.pointer('pointerup');
  assert.equal(player.frame.input.records.length, record_count);
  assert.equal(player.pauses(), 0);
  player.input.set_text_input_active(false, new Set(['KeyX', 'mouse:0']));
  player.key('KeyX');
  assert.equal(player.frame.input.records.length, record_count);
  player.key('KeyX', false);
  player.key('KeyX');
  assert.equal(player.frame.input.records.at(-1).action_bits, 2);
  dispatch(player.window, 'blur');
  assert.equal(player.pauses(), 1);
  player.input.dispose();
});
