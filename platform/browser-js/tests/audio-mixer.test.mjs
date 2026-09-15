import test from 'node:test';
import assert from 'node:assert/strict';
import { Audio_Mixer } from '../build/audio-mixer.js';
import { DEFAULT_PLAYER_SETTINGS } from '../build/player-settings.js';

test('independent output gains start at saved amplitude and ramp continuously over 20ms', () => {
  const nodes = [];
  const context = { currentTime: 1, destination: {}, createGain() {
    const calls = [];
    const node = { calls, gain: {
      setValueAtTime: (...parameters) => calls.push(['set', ...parameters]),
      cancelScheduledValues: (...parameters) => calls.push(['cancel', ...parameters]),
      linearRampToValueAtTime: (...parameters) => calls.push(['ramp', ...parameters]),
    }, connect(destination) { this.destination = destination; }, disconnect() { this.disconnected = true; } };
    nodes.push(node); return node;
  } };
  const mixer = new Audio_Mixer(context, DEFAULT_PLAYER_SETTINGS);
  assert.deepEqual(nodes.map(node => node.calls[0]), [['set', .7, 1], ['set', .8, 1]]);
  assert.ok(nodes.every(node => node.destination === context.destination));
  mixer.update({ ...DEFAULT_PLAYER_SETTINGS, music_volume: 0 });
  assert.deepEqual(nodes[0].calls.at(-1), ['ramp', 0, 1.02]);
  assert.equal(nodes[1].calls.length, 1);
  context.currentTime = 1.01;
  mixer.update({ ...DEFAULT_PLAYER_SETTINGS, music_volume: 100, effects_volume: 0 });
  assert.ok(Math.abs(nodes[0].calls.at(-2)[1] - .35) < 1e-12);
  assert.deepEqual(nodes[1].calls.at(-1), ['ramp', 0, 1.03]);
  mixer.dispose(); mixer.dispose();
  const counts = nodes.map(node => node.calls.length);
  mixer.update(DEFAULT_PLAYER_SETTINGS);
  assert.deepEqual(nodes.map(node => node.calls.length), counts);
  assert.ok(nodes.every(node => node.disconnected));
});
