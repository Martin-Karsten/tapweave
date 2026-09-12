import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { zipSync, strToU8 } from 'fflate';
import { Engine_Bridge } from '../src/engine-bridge.mjs';
import { Selection_Controller } from '../src/selection.mjs';

const wasm_bytes = await readFile(new URL('../../../engine/artifacts/tapweave.wasm', import.meta.url));
const valid_map = 'osu file format v14\n[General]\nAudioFilename: music.wav\n[HitObjects]\n256,192,1000,1,0';

test('failed selection retains previous real prepared map and asset scope', async () => {
  const engine = await Engine_Bridge.create(wasm_bytes);
  const controller = new Selection_Controller(engine);
  try {
    await controller.load_files([new File([valid_map], 'good.osu')]);
    const previous = controller.active;
    assert.equal(previous.music_status, 'missing');
    await controller.load_files([new File(['invalid'], 'bad.osu')]);
    assert.strictEqual(controller.active, previous);
    assert.equal(controller.error.code, 'ENGINE_5');
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
    const slow_load = controller.load_files([delayed_file]);
    await controller.load_files([new File([valid_map], 'latest.osu')]);
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
    await controller.load_files([new File([archive], 'map.osz')]);
    const source = controller.active.source;
    await controller.select_map('set/hard.osu');
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
  const pending = controller.load_files([new File([valid_map], 'map.osu'), new File([new Uint8Array(4)], 'music.wav')]);
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
    await controller.load_files([new File([valid_map], 'previous.osu')]);
    const previous = controller.active;
    for (let load_index = 0; load_index < 3; load_index++) {
      const stale_candidate = controller.pending_candidate;
      pending_loads.push(controller.load_files([
        new File([valid_map], 'candidate.osu'), new File([new Uint8Array(4)], 'music.wav'),
      ]));
      if (stale_candidate) {
        assert.equal(stale_candidate.source.disposed, true);
        assert.equal(stale_candidate.prepared_map, null);
      }
      while (finish_decodes.length <= load_index) {
        await new Promise(resolve => setImmediate(resolve));
      }
      assert.equal(engine.map_handles.size, 2);
      assert.strictEqual(controller.active, previous);
      assert.equal(previous.source.disposed, false);
    }
    await controller.load_files([new File(['invalid'], 'bad.osu')]);
    assert.equal(engine.map_handles.size, 1);
    assert.strictEqual(controller.active, previous);
    assert.equal(controller.error.code, 'ENGINE_5');
    for (const finish_decode of finish_decodes) {
      finish_decode({ length: 100, numberOfChannels: 2 });
    }
    await Promise.all(pending_loads);
    assert.strictEqual(controller.active, previous);
    assert.equal(controller.error.code, 'ENGINE_5');
  } finally {
    controller.dispose();
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
    await controller.load_files([
      new File([silent_map], 'easy.osu'), new File([valid_map], 'hard.osu'),
      new File([new Uint8Array(4)], 'music.wav'),
    ]);
    const source = controller.active.source;
    const pending = controller.select_map('hard.osu');
    while (!finish_decode) {
      await new Promise(resolve => setImmediate(resolve));
    }
    await controller.select_map('easy.osu');
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
