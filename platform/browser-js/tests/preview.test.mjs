import test from 'node:test';
import assert from 'node:assert/strict';
import { audio_context_fixture } from './audio-fixture.mjs';
import { Music_Preview } from '../build/preview.js';

const fake_buffer = { duration: 75 };

test('preview starts looping at the preview point through the given destination', async () => {
  const context = audio_context_fixture();
  const preview = new Music_Preview(context, context.destination);
  assert.equal(await preview.start(fake_buffer, 30_000), true);
  assert.equal(context.sources.length, 1);
  const source = context.sources[0];
  assert.equal(source.loop, true);
  assert.equal(source.loopStart, 30);
  assert.equal(source.loopEnd, 75);
  assert.equal(source.destination.destination, context.destination);
  const start_call = context.calls.find(entry => entry[0] === 'start');
  assert.deepEqual(start_call, ['start', 10, 30]);
  const ramp = context.calls.filter(entry => entry[0] === 'ramp');
  assert.equal(ramp.length, 1);
  assert.equal(ramp[0][1], 0.4);
  assert.equal(ramp[0][2], 10.2);
});

test('negative or out-of-range preview points start from zero', async () => {
  const context = audio_context_fixture();
  const preview = new Music_Preview(context, context.destination);
  await preview.start(fake_buffer, -1);
  assert.equal(context.sources[0].loopStart, 0);
  await preview.start(fake_buffer, 999_000);
  assert.equal(context.sources[1].loopStart, 0);
});

test('a context that cannot run starts nothing and reports silence', async () => {
  const context = audio_context_fixture();
  context.state = 'closed';
  const preview = new Music_Preview(context, context.destination);
  assert.equal(await preview.start(fake_buffer, 0), false);
  assert.equal(context.sources.length, 0);
});

test('a suspended context resumes through user activation or reports silence', async () => {
  const resumable = audio_context_fixture();
  resumable.state = 'suspended';
  const resumable_preview = new Music_Preview(resumable, resumable.destination);
  assert.equal(await resumable_preview.start(fake_buffer, 0), true);
  assert.equal(resumable.sources.length, 1);

  const refusing = audio_context_fixture();
  refusing.state = 'suspended';
  refusing.resume = async () => { throw new Error('denied'); };
  const refusing_preview = new Music_Preview(refusing, refusing.destination);
  assert.equal(await refusing_preview.start(fake_buffer, 0), false);
  assert.equal(refusing.sources.length, 0);
});

test('stopping fades the source out and a restart replaces it', async () => {
  const context = audio_context_fixture();
  const preview = new Music_Preview(context, context.destination);
  await preview.start(fake_buffer, 0);
  const first_source = context.sources[0];
  preview.stop();
  assert.ok(context.calls.some(entry => entry[0] === 'stop'));
  first_source.onended();
  assert.equal(first_source.disconnected, true);

  await preview.start(fake_buffer, 0);
  preview.stop();
  const second_source = context.sources[1];
  second_source.onended();
  assert.equal(second_source.disconnected, true);
  assert.equal(context.sources.length, 2);
});

test('stopping without a running preview is a no-op', () => {
  const context = audio_context_fixture();
  const preview = new Music_Preview(context, context.destination);
  assert.doesNotThrow(() => preview.stop());
});
