import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { create_engine } from './helpers.mjs';
import { Scene_Output } from '../build/engine-bridge.js';
import { Render_Resources } from '../build/render-resources.js';
import { schema } from '../../../engine/abi/records.mjs';
import { Renderer } from '../build/renderer.js';

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

test('mixed scene reads preserve gameplay, pending audio acknowledgement and prior publication', async () => {
  const engine = await create_engine();
  try {
    const map = engine.prepare_map(mixed_map);
    const resources = engine.scene_resources(map.map_handle);
    const session = engine.create_session(map.map_handle, { input_capacity: 32, batch_capacity: 32 });
    const capacity = engine.scene_reserve(session);
    engine.scene_reserve(session, capacity.required_instances, capacity.required_bytes);
    const output = new Scene_Output(resources, engine.snapshot(session, 0).summary.epoch);
    engine.submit_inputs(session, [{ sequence: 1n, raw_time_ms: 1000, effective_time_ms: 1000, x: 100, y: 100, action_bits: 1 }]);
    const gameplay = engine.advance(session, 1000);
    const pending_token = gameplay.summary.batch_token;
    assert.notEqual(pending_token, 0n);
    const before = engine.snapshot(session, 1000);
    const token_offset = schema.records.find(record => record.kind === 19).fields.batch_token[0];
    for (const time_ms of [1100, 6000, 500, 1700, 1100]) engine.scene_draw(session, time_ms, viewport, output);
    const after = engine.snapshot(session, 1000);
    // Diagnostic snapshot publication increments its batch token independently
    // of rendering. Every canonical state/judgement/audio byte must be stable.
    assert.equal(after.summary.batch_token, before.summary.batch_token + 1n);
    before.bytes.fill(0, token_offset, token_offset + 8);
    after.bytes.fill(0, token_offset, token_offset + 8);
    assert.deepEqual(after.bytes, before.bytes);
    const prior_draw = digest(output);
    assert.throws(() => engine.scene_draw(session, NaN, viewport, output), { code: 'ENGINE_1' });
    assert.equal(digest(output), prior_draw);
    engine.acknowledge(session, after.summary.batch_token);
    engine.scene_draw(session, 1100, viewport, output);
    assert.equal(digest(output), prior_draw);
    engine.reset_session(session);
    assert.throws(() => engine.scene_draw(session, 1100, viewport, output), { code: 'INVALID_DRAW' });
  } finally { engine.dispose(); }
});


test('scene frames publish f32-exact viewport uniforms the executor used to derive', async () => {
  const engine = await create_engine();
  try {
    const map = engine.prepare_map(mixed_map);
    const resources = engine.scene_resources(map.map_handle);
    const session = engine.create_session(map.map_handle, { input_capacity: 32, batch_capacity: 32 });
    const capacity = engine.scene_reserve(session);
    engine.scene_reserve(session, capacity.required_instances, capacity.required_bytes);
    const output = new Scene_Output(resources, engine.snapshot(session, 0).summary.epoch);
    for (const probe_viewport of [viewport, { css_left: 0, css_top: 0, css_width: 512, css_height: 384, device_pixel_ratio: 1 },
      { css_left: 240.5, css_top: -60.25, css_width: 1512, css_height: 982, device_pixel_ratio: 1.5 }]) {
      engine.scene_draw(session, 1400, probe_viewport, output);
      // The engine-computed uniforms must equal the previous executor
      // derivation: f64 operands in this order, rounded through f32 once.
      assert.equal(output.summary.uniform_scale_x, Math.fround(2 * output.summary.scale / probe_viewport.css_width));
      assert.equal(output.summary.uniform_scale_y, Math.fround(-2 * output.summary.scale / probe_viewport.css_height));
      assert.equal(output.summary.uniform_shift_x,
        Math.fround(2 * (output.summary.client_left - probe_viewport.css_left) / probe_viewport.css_width - 1));
      assert.equal(output.summary.uniform_shift_y,
        Math.fround(1 - 2 * (output.summary.client_top - probe_viewport.css_top) / probe_viewport.css_height));
    }
  } finally { engine.dispose(); }
});

test('renderer preparation rejects mismatched maps and stale epochs before acquiring a context', async () => {
  const engine = await create_engine();
  try {
    const map = engine.prepare_map(mixed_map);
    engine.scene_resources(map.map_handle);
    const other_map = engine.prepare_map(mixed_map);
    const session = engine.create_session(map.map_handle, { input_capacity: 32, batch_capacity: 32 });
    const epoch = engine.snapshot(session, 0).summary.epoch;
    const canvas = { getContext() { assert.fail('Invalid preparation must not acquire GPU resources'); } };
    assert.throws(() => new Renderer(engine, session, other_map.map_handle, canvas, epoch, () => {}), { code: 'INVALID_DRAW' });
    engine.reset_session(session);
    assert.throws(() => new Renderer(engine, session, map.map_handle, canvas, epoch, () => {}), { code: 'INVALID_DRAW' });
  } finally { engine.dispose(); }
});

test('scene capacity exhaustion preserves the last published frame bytes', async () => {
  const engine = await create_engine();
  try {
    const map = engine.prepare_map(mixed_map);
    const resources = engine.scene_resources(map.map_handle);
    const session = engine.create_session(map.map_handle, { input_capacity: 32, batch_capacity: 32 });
    const capacity = engine.scene_reserve(session);
    engine.scene_reserve(session, capacity.required_instances, capacity.required_bytes);
    const output = new Scene_Output(resources, capacity.epoch);
    engine.scene_draw(session, 1400, viewport, output);
    const busy_count = output.instances.count;
    engine.scene_draw(session, -5000, viewport, output);
    const quiet_count = output.instances.count;
    assert.ok(busy_count > quiet_count);
    engine.scene_reserve(session, quiet_count, capacity.required_bytes);
    engine.scene_draw(session, -5000, viewport, output);
    const prior = new Uint8Array(output.view.buffer, output.address, output.byte_count).slice();
    const address = output.address;
    assert.throws(() => engine.scene_draw(session, 1400, viewport, output), { code: 'ENGINE_8' });
    assert.equal(output.required.required_instances, busy_count);
    assert.deepEqual(new Uint8Array(engine.wasm.memory.buffer, address, prior.length), prior);
  } finally { engine.dispose(); }
});
