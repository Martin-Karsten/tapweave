import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { zipSync, strToU8 } from 'fflate';
import { Engine_Bridge } from '../build/engine-bridge.js';
import { Selection_Controller } from '../build/selection.js';

const wasm_bytes = await readFile(new URL('../../../engine/artifacts/tapweave.wasm', import.meta.url));
const valid_map = 'osu file format v14\n[General]\nAudioFilename: music.wav\n[HitObjects]\n256,192,1000,1,0';
const longer_map = `${valid_map}\n[Events]\n// extra section so the archived bytes differ in size`;

const hash_hex = async (bytes) => {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

test('failed selection retains previous real prepared map and asset scope', async () => {
  const engine = await Engine_Bridge.create(wasm_bytes);
  const controller = new Selection_Controller(engine);
  try {
    await controller.add_files([new File([valid_map], 'good.osu')]);
    const previous = controller.active;
    assert.equal(previous.music_status, 'missing');
    await controller.add_files([new File(['invalid'], 'bad.osu')]);
    assert.strictEqual(controller.active, previous);
    assert.equal(controller.error.code, 'ENGINE_5');
    assert.equal(controller.loaded_sets.length, 1);
    assert.equal(engine.map_handles.size, 1);
    assert.equal(engine.describe_map(previous.map_handle).summary.objects_count, 1);
  } finally {
    controller.dispose();
    assert.equal(engine.map_handles.size, 0);
    engine.dispose();
  }
});

test('latest asynchronous load wins without leaking a stale candidate', async () => {
  const engine = await Engine_Bridge.create(wasm_bytes);
  const controller = new Selection_Controller(engine);
  let resolve_file;
  const delayed_file = { name: 'slow.osu', size: valid_map.length,
    arrayBuffer: () => new Promise(resolve => { resolve_file = resolve; }) };
  try {
    const slow_load = controller.add_files([delayed_file]);
    await controller.add_files([new File([valid_map], 'latest.osu')]);
    resolve_file(strToU8(valid_map).buffer);
    await slow_load;
    assert.equal(controller.active.filename, 'latest.osu');
    assert.equal(engine.map_handles.size, 1);
    assert.equal(controller.error, null);
  } finally {
    controller.dispose();
    engine.dispose();
  }
});

test('difficulty switch reuses source, resolves relative music and releases prior map', async () => {
  const engine = await Engine_Bridge.create(wasm_bytes);
  let decode_count = 0;
  const controller = new Selection_Controller(engine, { decode_audio: async () => {
    decode_count++;
    return { length: 100, numberOfChannels: 2 };
  } });
  try {
    const archive = zipSync({ 'set/easy.osu': strToU8(valid_map), 'set/hard.osu': strToU8(valid_map),
      'set/music.wav': new Uint8Array(4) });
    await controller.add_files([new File([archive], 'map.osz')]);
    const source = controller.active.source;
    const set_id = controller.active.set_id;
    await controller.select_map(set_id, 'set/hard.osu');
    assert.strictEqual(controller.active.source, source);
    assert.equal(controller.active.music_status, 'decoded');
    assert.equal(engine.map_handles.size, 1);
    assert.equal(decode_count, 1);
  } finally {
    controller.dispose();
    engine.dispose();
  }
});

test('dispose during decode prevents publication and releases candidate map', async () => {
  const engine = await Engine_Bridge.create(wasm_bytes);
  let finish_decode;
  const controller = new Selection_Controller(engine, { decode_audio: () => new Promise(resolve => { finish_decode = resolve; }) });
  const pending = controller.add_files([new File([valid_map], 'map.osu'), new File([new Uint8Array(4)], 'music.wav')]);
  while (!finish_decode) {
    await new Promise(resolve => setImmediate(resolve));
  }
  controller.dispose();
  assert.equal(engine.map_handles.size, 0);
  assert.equal(controller.pending_candidate, null);
  finish_decode({ length: 100, numberOfChannels: 2 });
  await pending;
  assert.equal(controller.active, null);
  assert.equal(engine.map_handles.size, 0);
  engine.dispose();
});

test('replacement releases stale candidates before decodes settle', async () => {
  const engine = await Engine_Bridge.create(wasm_bytes);
  const finish_decodes = [];
  const pending_loads = [];
  const controller = new Selection_Controller(engine, {
    decode_audio: () => new Promise(resolve => finish_decodes.push(resolve)),
  });
  try {
    await controller.add_files([new File([valid_map], 'previous.osu')]);
    const previous = controller.active;
    for (let load_index = 0; load_index < 2; load_index++) {
      const stale_candidate = controller.pending_candidate;
      pending_loads.push(controller.add_files([
        new File([valid_map], 'candidate.osu'), new File([new Uint8Array(4)], 'music.wav'),
      ]));
      if (stale_candidate) {
        // Library-set scopes survive a superseded candidate; only its engine
        // map handle was released.
        assert.equal(stale_candidate.source.disposed, false);
        assert.equal(stale_candidate.prepared_map, null);
      }
      while (finish_decodes.length <= load_index) {
        await new Promise(resolve => setImmediate(resolve));
      }
      assert.equal(engine.map_handles.size, 2);
      assert.strictEqual(controller.active, previous);
      assert.equal(previous.source.disposed, false);
    }
    await controller.add_files([
      new File([valid_map], 'busy.osu'), new File([new Uint8Array(4)], 'music.wav'),
    ]);
    assert.equal(controller.error.code, 'QUOTA_EXCEEDED');
    assert.equal(controller.audio_decoder.active_count, 2);
    assert.equal(finish_decodes.length, 2);
    assert.strictEqual(controller.active, previous);
    await controller.add_files([new File(['invalid'], 'bad.osu')]);
    assert.equal(engine.map_handles.size, 1);
    assert.strictEqual(controller.active, previous);
    assert.equal(controller.error.code, 'ENGINE_5');
    for (const finish_decode of finish_decodes) {
      finish_decode({ length: 100, numberOfChannels: 2 });
    }
    await Promise.all(pending_loads);
    assert.equal(controller.audio_decoder.active_count, 0);
    assert.equal(controller.audio_decoder.encoded_bytes, 0);
    assert.strictEqual(controller.active, previous);
    assert.equal(controller.error.code, 'ENGINE_5');
    // Both superseded imports stayed in the library; disposal happens on
    // controller teardown without leaking engine handles.
    assert.equal(controller.loaded_sets.length, 3);
  } finally {
    controller.dispose();
    assert.equal(engine.map_handles.size, 0);
    engine.dispose();
  }
});

test('cancelling a difficulty candidate preserves the shared active asset scope', async () => {
  const engine = await Engine_Bridge.create(wasm_bytes);
  let finish_decode;
  const controller = new Selection_Controller(engine, {
    decode_audio: () => new Promise(resolve => { finish_decode = resolve; }),
  });
  try {
    const silent_map = valid_map.replace('music.wav', 'missing.wav');
    await controller.add_files([
      new File([silent_map], 'easy.osu'), new File([valid_map], 'hard.osu'),
      new File([new Uint8Array(4)], 'music.wav'),
    ]);
    const source = controller.active.source;
    const set_id = controller.active.set_id;
    const pending = controller.select_map(set_id, 'hard.osu');
    while (!finish_decode) {
      await new Promise(resolve => setImmediate(resolve));
    }
    await controller.select_map(set_id, 'easy.osu');
    assert.equal(engine.map_handles.size, 1);
    assert.equal(source.disposed, false);
    finish_decode({ length: 100, numberOfChannels: 2 });
    await pending;
    assert.equal(controller.active.filename, 'easy.osu');
    assert.strictEqual(controller.active.source, source);
    assert.equal(source.disposed, false);
    assert.equal(controller.pending_candidate, null);
    assert.equal(controller.error, null);
  } finally {
    controller.dispose();
    engine.dispose();
  }
});

test('concurrent difficulty candidates share one in-flight decode in the retained source', async () => {
  const engine = await Engine_Bridge.create(wasm_bytes);
  let finish_decode;
  let decode_count = 0;
  const controller = new Selection_Controller(engine, { decode_audio: () => {
    decode_count++;
    return new Promise(resolve => { finish_decode = resolve; });
  } });
  try {
    await controller.add_files([
      new File([valid_map.replace('music.wav', 'missing.wav')], 'easy.osu'),
      new File([valid_map], 'hard.osu'), new File([new Uint8Array(4)], 'music.wav'),
    ]);
    const set_id = controller.active.set_id;
    const first_candidate = controller.select_map(set_id, 'hard.osu');
    while (!finish_decode) {
      await new Promise(resolve => setImmediate(resolve));
    }
    const second_candidate = controller.select_map(set_id, 'hard.osu');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(decode_count, 1);
    assert.equal(controller.audio_decoder.active_count, 1);
    finish_decode({ length: 100, numberOfChannels: 2 });
    await Promise.all([first_candidate, second_candidate]);
    assert.equal(controller.active.filename, 'hard.osu');
    assert.equal(controller.active.source.decoded_audio_bytes, 800);
    assert.equal(controller.active.source.pending_audio.size, 0);
    assert.equal(engine.map_handles.size, 1);
  } finally {
    controller.dispose();
    engine.dispose();
  }
});

// Engine preparation rejections retain the attempted difficulty name so the
// shell can name the map that refused to load (non-standard rulesets etc.).
test('unsupported ruleset rejection carries the attempted filename in its details', async () => {
  const engine = await Engine_Bridge.create(wasm_bytes);
  const controller = new Selection_Controller(engine);
  try {
    await controller.add_files([new File([valid_map.replace('AudioFilename: music.wav', 'AudioFilename: music.wav\nMode: 2')], 'catch.osu')]);
    assert.equal(controller.active, null);
    assert.equal(controller.loaded_sets.length, 0);
    assert.equal(controller.error.code, 'ENGINE_3');
    assert.equal(controller.error.details.status_name, 'UNSUPPORTED');
    assert.equal(controller.error.details.code, 7);
    assert.equal(controller.error.details.filename, 'catch.osu');
    // A later valid load clears the annotated failure.
    await controller.add_files([new File([valid_map], 'standard.osu')]);
    assert.equal(controller.error, null);
    assert.equal(controller.active.filename, 'standard.osu');
  } finally {
    controller.dispose();
    engine.dispose();
  }
});

test('adding a second set keeps the first usable and selects into the new set', async () => {
  const engine = await Engine_Bridge.create(wasm_bytes);
  const controller = new Selection_Controller(engine);
  try {
    await controller.add_files([new File([valid_map], 'first.osu')]);
    const first_set = controller.loaded_sets[0];
    assert.equal(controller.active.filename, 'first.osu');
    await controller.add_files([new File([valid_map], 'second.osu')]);
    assert.equal(controller.loaded_sets.length, 2);
    assert.equal(controller.active.filename, 'second.osu');
    assert.equal(controller.active.set_id, controller.loaded_sets[1].set_id);
    assert.equal(first_set.source.disposed, false);
    assert.equal(engine.map_handles.size, 1);
    // Cross-set navigation stays available in both directions.
    await controller.select_map(first_set.set_id, 'first.osu');
    assert.equal(controller.active.filename, 'first.osu');
    assert.equal(controller.active.set_id, first_set.set_id);
    assert.equal(controller.loaded_sets[1].source.disposed, false);
    assert.equal(engine.map_handles.size, 1);
  } finally {
    controller.dispose();
    engine.dispose();
  }
});

test('identical difficulty filenames in different sets stay addressable by set id', async () => {
  const engine = await Engine_Bridge.create(wasm_bytes);
  const controller = new Selection_Controller(engine);
  try {
    await controller.add_files([new File([valid_map], 'map.osu')]);
    const loose_set = controller.loaded_sets[0];
    const archive = zipSync({ 'map.osu': strToU8(longer_map) });
    await controller.add_files([new File([archive], 'map.osz')]);
    const archive_set = controller.loaded_sets[1];
    assert.deepEqual(archive_set.source.list_maps(), ['map.osu']);
    await controller.select_map(loose_set.set_id, 'map.osu');
    assert.equal(controller.active.set_id, loose_set.set_id);
    await controller.select_map(archive_set.set_id, 'map.osu');
    assert.equal(controller.active.set_id, archive_set.set_id);
    assert.equal(controller.active.source.list_maps().includes('map.osu'), true);
    assert.equal(engine.map_handles.size, 1);
  } finally {
    controller.dispose();
    engine.dispose();
  }
});

test('a failed import admits no set and keeps the standing selection', async () => {
  const engine = await Engine_Bridge.create(wasm_bytes);
  const controller = new Selection_Controller(engine);
  try {
    await controller.add_files([new File([valid_map], 'previous.osu')]);
    const previous = controller.active;
    await controller.add_files([new File([valid_map], 'rejected.osu')], {
      validate: async () => {
        throw new Error('Incompatible files');
      },
    });
    assert.equal(controller.loaded_sets.length, 1);
    assert.strictEqual(controller.active, previous);
    assert.match(controller.error.message, /Incompatible/);
    assert.equal(engine.map_handles.size, 1);
  } finally {
    controller.dispose();
    engine.dispose();
  }
});

test('removing an inactive set disposes its scope and keeps the active selection', async () => {
  const engine = await Engine_Bridge.create(wasm_bytes);
  const controller = new Selection_Controller(engine);
  try {
    const archive = zipSync({ 'set/easy.osu': strToU8(valid_map), 'set/hard.osu': strToU8(valid_map) });
    await controller.add_files([new File([archive], 'map.osz')]);
    await controller.add_files([new File([valid_map], 'second.osu')]);
    const removed_set = controller.loaded_sets[0];
    const previous = controller.active;
    await controller.remove_set(removed_set.set_id);
    assert.equal(controller.loaded_sets.length, 1);
    assert.equal(removed_set.source.disposed, true);
    assert.strictEqual(controller.active, previous);
    assert.equal(controller.active.set_id, controller.loaded_sets[0].set_id);
    assert.equal(engine.map_handles.size, 1);
  } finally {
    controller.dispose();
    engine.dispose();
  }
});

test('removing the active set prepares a neighbouring successor then disposes the removed scope', async () => {
  const engine = await Engine_Bridge.create(wasm_bytes);
  const controller = new Selection_Controller(engine);
  try {
    await controller.add_files([new File([valid_map], 'first.osu')]);
    const first_set = controller.loaded_sets[0];
    const archive = zipSync({ 'other/only.osu': strToU8(valid_map) });
    await controller.add_files([new File([archive], 'second.osz')]);
    const second_set = controller.loaded_sets[1];
    assert.equal(controller.active.filename, 'other/only.osu');
    await controller.remove_set(second_set.set_id);
    assert.equal(controller.loaded_sets.length, 1);
    assert.equal(controller.loaded_sets[0], first_set);
    assert.equal(controller.active.filename, 'first.osu');
    assert.equal(controller.active.set_id, first_set.set_id);
    assert.equal(second_set.source.disposed, true);
    assert.equal(first_set.source.disposed, false);
    assert.equal(controller.state, 'prepared');
    assert.equal(controller.error, null);
    assert.equal(engine.map_handles.size, 1);
  } finally {
    controller.dispose();
    engine.dispose();
  }
});

test('removing the last set clears the selection and releases every resource', async () => {
  const engine = await Engine_Bridge.create(wasm_bytes);
  const controller = new Selection_Controller(engine);
  try {
    await controller.add_files([new File([valid_map], 'only.osu')]);
    const only_set = controller.loaded_sets[0];
    await controller.remove_set(only_set.set_id);
    assert.equal(controller.loaded_sets.length, 0);
    assert.equal(controller.active, null);
    assert.equal(controller.state, 'empty');
    assert.equal(controller.error, null);
    assert.equal(only_set.source.disposed, true);
    assert.equal(engine.map_handles.size, 0);
  } finally {
    controller.dispose();
    engine.dispose();
  }
});

test('a failed successor selection re-inserts the removed set and keeps the old selection', async () => {
  const engine = await Engine_Bridge.create(wasm_bytes);
  const controller = new Selection_Controller(engine);
  try {
    await controller.add_files([new File([valid_map], 'first.osu')]);
    await controller.add_files([new File([valid_map], 'second.osu')]);
    const removed_set = controller.loaded_sets[1];
    const previous = controller.active;
    await controller.remove_set(removed_set.set_id, {
      choose_map: async () => {
        throw new Error('No successor difficulty');
      },
    });
    assert.equal(controller.loaded_sets.length, 2);
    assert.equal(controller.loaded_sets[1], removed_set);
    assert.strictEqual(controller.active, previous);
    assert.equal(removed_set.source.disposed, false);
    assert.match(controller.error.message, /No successor/);
  } finally {
    controller.dispose();
    engine.dispose();
  }
});

test('remove_set refuses while a selection change is in flight', async () => {
  const engine = await Engine_Bridge.create(wasm_bytes);
  let finish_decode;
  const controller = new Selection_Controller(engine, {
    decode_audio: () => new Promise(resolve => { finish_decode = resolve; }),
  });
  try {
    const pending_add = controller.add_files([
      new File([valid_map], 'map.osu'), new File([new Uint8Array(4)], 'music.wav'),
    ]);
    while (!finish_decode) {
      await new Promise(resolve => setImmediate(resolve));
    }
    await assert.rejects(controller.remove_set(1), (error) => error.code === 'INVALID_STATE');
    finish_decode({ length: 100, numberOfChannels: 2 });
    await pending_add;
    assert.equal(controller.active.filename, 'map.osu');
    await controller.remove_set(1);
    assert.equal(controller.state, 'empty');
  } finally {
    controller.dispose();
    engine.dispose();
  }
});

test('library admission rejects sets beyond count and byte quotas', async () => {
  const engine = await Engine_Bridge.create(wasm_bytes);
  const bounded_controller = new Selection_Controller(engine, { max_loaded_sets: 2 });
  const loose_controller = new Selection_Controller(engine, { max_total_library_bytes: 1 });
  try {
    await bounded_controller.add_files([new File([valid_map], 'one.osu')]);
    await bounded_controller.add_files([new File([valid_map], 'two.osu')]);
    const active_before = bounded_controller.active;
    await bounded_controller.add_files([new File([valid_map], 'three.osu')]);
    assert.equal(bounded_controller.loaded_sets.length, 2);
    assert.strictEqual(bounded_controller.active, active_before);
    assert.equal(bounded_controller.error.code, 'QUOTA_EXCEEDED');
    // Loose sets retain File references rather than archive bytes, so the
    // compressed-byte budget alone does not refuse them.
    await loose_controller.add_files([new File([valid_map], 'loose.osu')]);
    assert.equal(loose_controller.loaded_sets.length, 1);
    assert.equal(loose_controller.error, null);
    const archive = zipSync({ 'map.osu': strToU8(valid_map) });
    await loose_controller.add_files([new File([archive], 'map.osz')]);
    assert.equal(loose_controller.loaded_sets.length, 1);
    assert.equal(loose_controller.error.code, 'QUOTA_EXCEEDED');
  } finally {
    bounded_controller.dispose();
    loose_controller.dispose();
    engine.dispose();
  }
});

test('find_map_by_hash locates a difficulty across sets by exact bytes', async () => {
  const engine = await Engine_Bridge.create(wasm_bytes);
  const controller = new Selection_Controller(engine);
  try {
    await controller.add_files([new File([valid_map], 'first.osu')]);
    const archive = zipSync({ 'deep/second.osu': strToU8(longer_map) });
    await controller.add_files([new File([archive], 'second.osz')]);
    const second_set = controller.loaded_sets[1];
    const expected_hash = await hash_hex(await second_set.source.read('deep/second.osu'));
    const match = await controller.find_map_by_hash(hash_hex, expected_hash);
    assert.deepEqual(match, { set_id: second_set.set_id, filename: 'deep/second.osu' });
    const absent = await controller.find_map_by_hash(hash_hex, '6'.repeat(64));
    assert.equal(absent, null);
  } finally {
    controller.dispose();
    engine.dispose();
  }
});

test('background summaries describe every difficulty on their own engine', async () => {
  const engine = await Engine_Bridge.create(wasm_bytes);
  const summary_engine = await Engine_Bridge.create(wasm_bytes);
  const controller = new Selection_Controller(engine, {
    decode_audio: async () => ({ length: 100, numberOfChannels: 2 }),
    summary_engine_factory: async () => summary_engine,
  });
  try {
    const archive = zipSync({ 'set/easy.osu': strToU8(valid_map), 'set/hard.osu': strToU8(valid_map),
      'set/music.wav': new Uint8Array(4) });
    await controller.add_files([new File([archive], 'map.osz')]);
    const gameplay_engine_handles_before = engine.map_handles.size;
    await controller.describe_summaries();
    const first_set = controller.loaded_sets[0];
    assert.equal(first_set.summaries.size, 2);
    const easy = first_set.summaries.get('set/easy.osu');
    assert.equal(easy.title, 'Unknown');
    assert.equal(easy.version, 'Normal');
    assert.equal(easy.objects_count, 1);
    assert.equal(easy.cs, 5);
    // Summary handles were released and the gameplay engine was untouched.
    assert.equal(summary_engine.map_handles.size, 0);
    assert.equal(engine.map_handles.size, gameplay_engine_handles_before);
    // The cache survives difficulty switches inside the same set.
    await controller.select_map(first_set.set_id, 'set/hard.osu');
    assert.equal(first_set.summaries.size, 2);
    // A newly added set starts from its own empty cache while the first
    // set's summaries survive.
    await controller.add_files([new File([valid_map], 'single.osu')]);
    assert.equal(controller.loaded_sets[0].summaries.size, 2);
    assert.equal(controller.loaded_sets[1].summaries.size, 0);
    assert.equal(controller.loaded_sets[1].summary_failures.size, 0);
    await controller.describe_summaries();
    assert.equal(controller.loaded_sets[1].summaries.size, 1);
  } finally {
    controller.dispose();
    engine.dispose();
    summary_engine.dispose();
  }
});

test('summary passes isolate one unsupported difficulty without touching selection', async () => {
  const engine = await Engine_Bridge.create(wasm_bytes);
  const summary_engine = await Engine_Bridge.create(wasm_bytes);
  const controller = new Selection_Controller(engine, {
    summary_engine_factory: async () => summary_engine,
  });
  try {
    const taiko_map = 'osu file format v14\n[General]\nMode: 1\n[HitObjects]\n256,192,1000,1,0';
    const archive = zipSync({ 'a.osu': strToU8(valid_map), 'b.osu': strToU8(taiko_map) });
    await controller.add_files([new File([archive], 'map.osz')]);
    const active_before = controller.active;
    await controller.describe_summaries();
    const loaded_set = controller.loaded_sets[0];
    assert.equal(loaded_set.summaries.has('a.osu'), true);
    assert.equal(loaded_set.summaries.has('b.osu'), false);
    assert.match(loaded_set.summary_failures.get('b.osu'), /UNSUPPORTED/);
    assert.strictEqual(controller.active, active_before);
    assert.equal(controller.state, 'prepared');
    assert.equal(controller.error, null);
    // A repeated call does not retry recorded failures.
    await controller.describe_summaries();
    assert.equal(loaded_set.summaries.size, 1);
  } finally {
    controller.dispose();
    engine.dispose();
    summary_engine.dispose();
  }
});

test('without a summary factory the describe pass is a no-op', async () => {
  const engine = await Engine_Bridge.create(wasm_bytes);
  const controller = new Selection_Controller(engine);
  try {
    await controller.add_files([new File([valid_map], 'map.osu')]);
    await controller.describe_summaries();
    assert.equal(controller.loaded_sets[0].summaries.size, 0);
    assert.equal(controller.loaded_sets[0].summary_failures.size, 0);
  } finally {
    controller.dispose();
    engine.dispose();
  }
});

test('candidate admission failure and cancellation retain the previous prepared map', async () => {
  const engine = await Engine_Bridge.create(wasm_bytes);
  const controller = new Selection_Controller(engine);
  try {
    await controller.add_files([new File([valid_map], 'previous.osu')]);
    const previous = controller.active;
    await controller.add_files([new File([valid_map], 'wrong.osu')], {
      validate: async () => {
        throw new Error('Incompatible files');
      },
    });
    assert.strictEqual(controller.active, previous);
    assert.match(controller.error.message, /Incompatible/);
    let finish_validation;
    const pending = controller.add_files([new File([valid_map], 'cancelled.osu')], {
      validate: () => new Promise(resolve => {
        finish_validation = resolve;
      }),
    });
    while (!finish_validation) {
      await new Promise(resolve => setImmediate(resolve));
    }
    controller.cancel_pending();
    finish_validation();
    await pending;
    assert.strictEqual(controller.active, previous);
    assert.equal(controller.state, 'prepared');
    assert.equal(engine.map_handles.size, 1);
    await controller.add_files([new File([valid_map], 'first.osu'), new File([valid_map], 'chosen.osu')], {
      choose_map: async () => 'chosen.osu',
    });
    assert.equal(controller.active.filename, 'chosen.osu');
    assert.equal(engine.map_handles.size, 1);
  } finally {
    controller.dispose();
    engine.dispose();
  }
});
