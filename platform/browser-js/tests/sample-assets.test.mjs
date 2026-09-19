import test from 'node:test';
import assert from 'node:assert/strict';
import { load_sample_assets } from '../build/sample-assets.js';
import { create_fallback_audio } from '../build/fallback-audio.js';
import { audio_context_fixture } from './audio-fixture.mjs';

const probe_extensions = ['', '.wav', '.mp3', '.ogg'];
const description = (...samples) => ({ *sample_candidates() { yield* samples; } });
const sample = { object_id: 0, component_id: 0xffffffff, sample_index: 0, name: 'hitnormal', use_beatmap: true,
  candidates: ['Gameplay/normal-hitnormal2', 'Gameplay/normal-hitnormal', 'Gameplay/hitnormal'] };

test('custom bank availability preserves every ordinal, source priority and deduplicated IDs', async () => {
  const reads = [];
  const buffer = {};
  const fallback = {};
  const source = {
    async read(filename) { reads.push(filename); return filename === 'set/normal-hitnormal2.wav' ? new Uint8Array([1]) : null; },
    async decode_music() { return buffer; },
  };
  const loaded = await load_sample_assets(description(sample, { ...sample, object_id: 1 }), source, 'set/map.osu', async () => {}, probe_extensions,
    { fallback_assets: new Map([['Gameplay/hitnormal', fallback]]) });
  assert.deepEqual(loaded.bindings.map(binding => binding.asset_id), [1n, 0n, 2n, 1n, 0n, 2n]);
  assert.equal(loaded.assets.size, 2);
  assert.equal(reads.filter(filename => filename === 'set/normal-hitnormal2.wav').length, 1);
  assert.deepEqual(loaded.warnings, []);
});

test('bank zero skips beatmap files, corrupt candidates fall through, missing assets warn', async () => {
  const source = {
    async read() { return new Uint8Array([1]); },
    async decode_music() { throw new Error('invalid codec'); },
  };
  const loaded = await load_sample_assets(description(sample), source, 'map.osu', async () => {}, probe_extensions);
  assert.ok(loaded.bindings.every(binding => binding.asset_id === 0n));
  assert.match(loaded.warnings.at(-1), /Missing hitsound/);
  const bank_zero = await load_sample_assets(description({ ...sample, use_beatmap: false }),
    { read() { throw new Error('must not read'); } }, 'map.osu', async () => {}, probe_extensions,
    { fallback_assets: new Map([['Gameplay/hitnormal', {}]]) });
  assert.equal(bank_zero.bindings[2].asset_id, 1n);
});

test('a refused extension covered by the same name in another encoding stays unreported', async () => {
  const decoded = {};
  const source = {
    async read(filename) { return filename.endsWith('.ogg') ? new Uint8Array([1]) : new Uint8Array([1]); },
    async decode_music(filename) {
      if (filename.endsWith('.wav')) throw new Error('decodeAudioData failed');
      return decoded;
    },
  };
  const soft_slide = { ...sample, name: 'sliderslide', candidates: ['Gameplay/soft-sliderslide'] };
  const loaded = await load_sample_assets(description(soft_slide), source, 'map.osu', async () => {}, probe_extensions);
  assert.equal(loaded.bindings[0].asset_id, 1n);
  assert.deepEqual(loaded.warnings, []);
});

test('a refused name playing a substitute sound emits one clear note instead of a fatal line', async () => {
  const fallback = {};
  const source = {
    async read(filename) { return filename.endsWith('.wav') ? new Uint8Array([1]) : null; },
    async decode_music() { throw new Error('decodeAudioData failed'); },
  };
  const samples = description(
    { ...sample, name: 'sliderslide', object_id: 1, candidates: ['Gameplay/soft-sliderslide', 'Gameplay/sliderslide'] },
    { ...sample, name: 'sliderslide', object_id: 2, candidates: ['Gameplay/soft-sliderslide', 'Gameplay/sliderslide'] },
  );
  const loaded = await load_sample_assets(samples, source, 'map.osu', async () => {}, probe_extensions,
    { fallback_assets: new Map([['Gameplay/sliderslide', fallback]]) });
  // Both samples play through the unbanked fallback binding; the banked
  // candidate legitimately binds zero and the engine falls through it.
  assert.ok(loaded.bindings.filter(binding => binding.candidate_index === 1)
    .every(binding => binding.asset_id === 1n));
  assert.equal(loaded.warnings.length, 1);
  assert.match(loaded.warnings[0], /Could not decode hitsound soft-sliderslide\.wav; a substitute sound plays instead\./);
  assert.doesNotMatch(loaded.warnings[0], /Missing hitsound/);
});

test('sample quota and cancellation reject without publishing partially loaded assets', async () => {
  await assert.rejects(load_sample_assets(description(sample), { async read() { return null; } }, 'map.osu', async () => {}, probe_extensions,
    { maximum_assets: 1 }), { code: 'QUOTA_EXCEEDED' });
  let cancelled = false;
  let finish_decode;
  const loading = load_sample_assets(description(sample), {
    async read() { return new Uint8Array([1]); },
    decode_music() { return new Promise(resolve => { finish_decode = resolve; }); },
  }, 'map.osu', async () => {}, probe_extensions, { cancelled: () => cancelled });
  await new Promise(resolve => setImmediate(resolve));
  cancelled = true;
  finish_decode({});
  await assert.rejects(loading, { code: 'CANCELLED' });
});

test('original fallback assets are finite, audible and bounded', () => {
  const assets = create_fallback_audio(audio_context_fixture());
  assert.equal(assets.size, 9);
  let byte_count = 0;
  for (const buffer of assets.values()) {
    const samples = buffer.getChannelData(0);
    assert.ok(samples.every(Number.isFinite));
    assert.ok(samples.some(sample => Math.abs(sample) > 0.05));
    byte_count += samples.byteLength;
  }
  assert.ok(byte_count < 128 * 1024);
});
