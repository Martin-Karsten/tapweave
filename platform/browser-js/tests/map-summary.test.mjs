import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Engine_Bridge } from '../build/engine-bridge.js';
import { drain_ms, map_summary_of } from '../build/map-summary.js';

const wasm_bytes = await readFile(new URL('../../../engine/artifacts/tapweave.wasm', import.meta.url));

test('drain time subtracts only the break overlap inside the playable span', () => {
  assert.equal(drain_ms(0, 10_000, []), 10_000);
  assert.equal(drain_ms(0, 10_000, [{ start_ms: 2_000, end_ms: 5_000 }]), 7_000);
  // Breaks partially outside the span clip to the overlap.
  assert.equal(drain_ms(3_000, 10_000, [{ start_ms: 0, end_ms: 4_000 }]), 6_000);
  assert.equal(drain_ms(0, 5_000, [{ start_ms: 4_000, end_ms: 9_000 }]), 4_000);
  // Breaks outside the span and empty maps change nothing.
  assert.equal(drain_ms(0, 5_000, [{ start_ms: 6_000, end_ms: 9_000 }]), 5_000);
  assert.equal(drain_ms(2_000, 2_000, [{ start_ms: 0, end_ms: 9_000 }]), 0);
});

test('foundation summaries expose metadata, difficulty, bpm and duration', async () => {
  const engine = await Engine_Bridge.create(wasm_bytes);
  try {
    const map_text = 'osu file format v14\n' +
      '[Metadata]\nTitle: Neon Sky\nArtist: Aurora\nCreator: Weaver\nVersion: Hard\n' +
      '[Difficulty]\nHPDrainRate:6\nCircleSize:4\nOverallDifficulty:8\nApproachRate:9\n' +
      '[TimingPoints]\n1000,375,4,2,1,70,1,0\n2000,-100,4,2,1,70,0,0\n' +
      '[HitObjects]\n64,96,1000,1,0\n256,192,2000,12,8,5200\n';
    const { map_handle, descriptor } = engine.prepare_map_foundation(new TextEncoder().encode(map_text));
    try {
      assert.equal(descriptor.metadata.title, 'Neon Sky');
      assert.equal(descriptor.metadata.version, 'Hard');
      assert.equal(descriptor.summary.cs, 4);
      assert.equal(descriptor.summary.ar, 9);
      assert.equal(descriptor.summary.bpm_min, 160);
      assert.equal(descriptor.summary.bpm_max, 160);
      assert.equal(descriptor.duration_ms(), 4200);
      const summary = map_summary_of('set/hard.osu', descriptor);
      assert.equal(summary.filename, 'set/hard.osu');
      assert.equal(summary.artist, 'Aurora');
      assert.equal(summary.creator, 'Weaver');
      assert.equal(summary.hp, 6);
      assert.equal(summary.od, 8);
      assert.equal(summary.duration_ms, 4200);
      assert.equal(summary.objects_count, 2);
    } finally {
      engine.release_map(map_handle);
    }
    assert.equal(engine.map_handles.size, 0);
  } finally {
    engine.dispose();
  }
});

test('maps without metadata or timing keep the decoder defaults', async () => {
  const engine = await Engine_Bridge.create(wasm_bytes);
  try {
    const map_text = 'osu file format v14\n[HitObjects]\n256,192,1000,1,0';
    const { map_handle, descriptor } = engine.prepare_map_foundation(new TextEncoder().encode(map_text));
    try {
      const summary = map_summary_of('fallback.osu', descriptor);
      assert.equal(summary.title, 'Unknown');
      assert.equal(summary.artist, 'Unknown');
      assert.equal(summary.creator, 'Unknown Creator');
      assert.equal(summary.version, 'Normal');
      assert.equal(summary.bpm_min, 0);
      assert.equal(summary.bpm_max, 0);
      assert.equal(summary.duration_ms, 0);
    } finally {
      engine.release_map(map_handle);
    }
  } finally {
    engine.dispose();
  }
});
