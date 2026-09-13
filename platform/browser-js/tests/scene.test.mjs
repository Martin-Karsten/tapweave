import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { create_engine } from './helpers.mjs';
import { Scene_Output } from '../build/engine-bridge.js';
import { Render_Resources } from '../build/render-resources.js';

export const mixed_map = new TextEncoder().encode(`osu file format v14
[Difficulty]
HPDrainRate:0
CircleSize:4
ApproachRate:5
SliderMultiplier:1.4
SliderTickRate:1
[TimingPoints]
0,500,4,1,1,100,1,0
[HitObjects]
100,100,1000,1,0
150,180,1500,2,0,L|380:180|150:180,2,460
256,192,5500,8,0,7000
`);
const viewport = { css_left: 13, css_top: 27, css_width: 1024, css_height: 768, device_pixel_ratio: 2 };
const digest = output => createHash('sha256').update(new Uint8Array(output.view.buffer, output.address, output.byte_count)).digest('hex');

test('mixed scene reserves independently, renders all primitives and survives map handle release', async () => {
  const engine = await create_engine();
  try {
    const map = engine.prepare_map(mixed_map);
    const resources = engine.scene_resources(map.map_handle);
    assert.equal(resources.scene, true);
    assert.equal(resources.summary.vertices_stride, 32);
    assert.ok(resources.summary.indices_count > 6);
    assert.ok(resources.summary.atlas_count > 4);
    assert.deepEqual(engine.scene_resources(map.map_handle).bytes, resources.bytes);
    const sessions = Array.from({ length: 4 }, () => engine.create_session(map.map_handle, { input_capacity: 32, batch_capacity: 32 }));
    for (const session of sessions) {
      const capacity = engine.scene_reserve(session);
      engine.scene_reserve(session, capacity.required_instances, capacity.required_bytes);
      const epoch = engine.snapshot(session, 0).summary.epoch;
      const output = new Scene_Output(resources, epoch);
      const memory = engine.wasm.memory.buffer.byteLength;
      const primitives = new Set();
      const record = {};
      for (const time_ms of [0, 700, 1400, 1700, 3000, 5500, 6000]) {
        engine.scene_draw(session, time_ms, viewport, output);
        for (let instance_index = 0; instance_index < output.instances.count; instance_index++) {
          output.record_into(output.instances, instance_index, record);
          primitives.add(record.primitive);
        }
      }
      assert.deepEqual([...primitives].sort(), [1, 2, 3, 4, 5]);
      const before = digest(engine.scene_draw(session, 1400, viewport, output));
      assert.equal(digest(engine.scene_draw(session, 1400, viewport, output)), before);
      engine.scene_draw(session, 6000, viewport, output);
      assert.equal(digest(engine.scene_draw(session, 1400, viewport, output)), before);
      assert.equal(engine.wasm.memory.buffer.byteLength, memory);
      assert.throws(() => engine.scene_reserve(session, 1000001, 1n), { code: 'ENGINE_4' });
      assert.equal(digest(engine.scene_draw(session, 1400, viewport, output)), before);
    }
    engine.release_map(map.map_handle);
    const output = new Scene_Output(resources, engine.snapshot(sessions[0], 0).summary.epoch);
    engine.scene_draw(sessions[0], 1400, viewport, output);
    assert.ok(output.instances.count > 0);
  } finally { engine.dispose(); }
});

test('scene resource recovery snapshot owns metadata and rejects bad geometry', async () => {
  const engine = await create_engine();
  try {
    const map = engine.prepare_map(mixed_map);
    const resources = engine.scene_resources(map.map_handle);
    const retained = resources.own_snapshot();
    const vertex_count = retained.summary.vertices_count;
    resources.summary.vertices_count = 0;
    assert.equal(retained.summary.vertices_count, vertex_count);
    const bytes = retained.bytes.slice();
    new DataView(bytes.buffer).setUint32(retained.summary.indices_offset, vertex_count, true);
    assert.throws(() => new Render_Resources(bytes), /Index references/);
  } finally { engine.dispose(); }
});
