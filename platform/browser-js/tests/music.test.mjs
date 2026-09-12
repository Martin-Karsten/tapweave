import test from 'node:test';
import assert from 'node:assert/strict';
import { Audio_Clock } from '../src/clock.mjs';
import { Music_Transport } from '../src/music.mjs';
import { Audio_Decoder } from '../src/audio-decoder.mjs';

function music_context() {
  const sources = [];
  return { sources, currentTime: 10, state: 'running', destination: {},
    createBufferSource() {
      const source = { playbackRate: { setValueAtTime() {} }, connect() {},
        disconnect() { this.disconnected = true; }, stop() { this.stopped = true; },
        start(when_seconds, offset_seconds) { this.start_values = [when_seconds, offset_seconds]; } };
      sources.push(source);
      return source;
    },
  };
}

test('music shares the audio anchor and resumes media without applying offsets twice', () => {
  const context = music_context();
  const clock = new Audio_Clock();
  const music = new Music_Transport(context, clock);
  assert.throws(() => music.start(), { code: 'INVALID_STATE' });
  music.set_buffer({ duration: 100 });
  clock.start(10, -500, { global_ms: 20 });
  music.start();
  const first = context.sources[0];
  assert.deepEqual(first.start_values, [10.5, 0]);
  const stale_ended = first.onended;
  music.cancel();
  assert.equal(first.stopped, true);
  assert.equal(first.disconnected, true);
  clock.pause(11);
  clock.resume(20);
  context.currentTime = 20;
  music.start();
  assert.deepEqual(context.sources[1].start_values, [20, 0.5]);
  stale_ended();
  assert.equal(music.source, context.sources[1]);
  music.dispose();
  music.dispose();
  assert.equal(music.buffer, null);
  assert.equal(music.source, null);
});

test('decoder quotas count uninterruptible work and release after failure', async () => {
  let complete_decode;
  const decoder = new Audio_Decoder(() => new Promise((resolve, reject) => { complete_decode = { resolve, reject }; }),
    { maximum_concurrent: 1, maximum_encoded_bytes: 8 });
  const pending = decoder.decode(new Uint8Array(8));
  await assert.rejects(decoder.decode(new Uint8Array(1)), { code: 'QUOTA_EXCEEDED' });
  assert.equal(decoder.encoded_bytes, 8);
  complete_decode.reject(new Error('decode failed'));
  await assert.rejects(pending, /decode failed/);
  assert.equal(decoder.active_count, 0);
  assert.equal(decoder.encoded_bytes, 0);
  const retry = decoder.decode(new Uint8Array(8));
  complete_decode.resolve({ length: 8, numberOfChannels: 1 });
  await retry;
  assert.equal(decoder.active_count, 0);
});
