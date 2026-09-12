import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Engine_Bridge, Gameplay_Output, Draw_Output } from '../build/engine-bridge.js';

const wasm_bytes = await readFile(new URL('../../../engine/artifacts/tapweave.wasm', import.meta.url));
const map_bytes = new TextEncoder().encode('osu file format v14\n[HitObjects]\n256,192,1000,1,0');
const viewport = { css_left: 0, css_top: 0, css_width: 512, css_height: 384, device_pixel_ratio: 1 };

test('draw health follows committed drain without advancing on future presentation reads', async () => {
  const engine = await Engine_Bridge.create(wasm_bytes);
  try {
    const prepared = engine.prepare_map(new TextEncoder().encode('osu file format v14\n[Difficulty]\nHPDrainRate:5\n[HitObjects]\n256,192,1000,1,0\n256,192,4000,1,0'));
    const resources = engine.render_resources(prepared.map_handle);
    const session = engine.create_session(prepared.map_handle, { input_capacity: 8, batch_capacity: 1 });
    const capacity = engine.render_reserve(session);
    engine.render_reserve(session, capacity.required_instances, capacity.required_bytes);
    engine.submit_inputs(session, [{ sequence: 1n, raw_time_ms: 1000, effective_time_ms: 1000, x: 256, y: 192, action_bits: 1 }]);
    const gameplay = new Gameplay_Output();
    engine.advance_output(session, 1500, gameplay);
    assert.ok(gameplay.summary.health < 1);
    const draw = engine.draw(session, 2000, viewport, new Draw_Output(resources, gameplay.summary.epoch));
    assert.equal(draw.summary.health, gameplay.summary.health);
    assert.equal(draw.summary.committed_ms, 1500);
    const after = engine.snapshot(session, 1500);
    assert.equal(after.summary.health, gameplay.summary.health);
  } finally { engine.dispose(); }
});

async function fixture() {
  const engine = await Engine_Bridge.create(wasm_bytes);
  const prepared = engine.prepare_map(map_bytes);
  const resources = engine.render_resources(prepared.map_handle);
  const session = engine.create_session(prepared.map_handle, { input_capacity: 8, batch_capacity: 8 });
  const summary = engine.snapshot(session, 0).summary;
  return { engine, session, resources, output: new Draw_Output(resources, summary.epoch) };
}

function copy_draw(output) {
  return new Uint8Array(output.view.buffer, output.address, output.byte_count).slice();
}

test('circle draw reserve, overflow and readonly feedback have independent publication', async () => {
  const { engine, session, output } = await fixture();
  try {
    const requirements = engine.render_reserve(session);
    assert.equal(requirements.required_instances, 24);
    engine.render_reserve(session, 1, 65536n);
    assert.throws(() => engine.draw(session, 500, viewport, output), { code: 'ENGINE_8' });
    assert.ok(output.required.required_instances > 1);
    engine.render_reserve(session, requirements.required_instances, requirements.required_bytes);
    const buffer = engine.wasm.memory.buffer;
    engine.draw(session, 500, viewport, output);
    assert.equal(output.instances.count, 4);
    const original = copy_draw(output);
    engine.draw(session, 500, viewport, output);
    assert.deepEqual(copy_draw(output), original);
    assert.throws(() => engine.draw(session, 500, { ...viewport, css_width: 0 }, output), { code: 'ENGINE_1' });
    assert.deepEqual(copy_draw(output), original);
    assert.throws(() => engine.render_reserve(session, 1, 0n), { code: 'ENGINE_4' });
    engine.draw(session, 500, viewport, output);
    assert.deepEqual(copy_draw(output), original);
    engine.submit_inputs(session, [{ sequence: 1n, raw_time_ms: 1000, effective_time_ms: 1000, x: 256, y: 192, action_bits: 1 }]);
    const gameplay = new Gameplay_Output();
    engine.advance_output(session, 1000, gameplay);
    const token = gameplay.summary.batch_token;
    engine.draw(session, 1100, viewport, output);
    assert.equal(output.summary.score, 1000000n);
    assert.equal(output.instances.count, 1);
    assert.equal(output.record_into(output.instances, 0, {}).primitive, 2);
    assert.equal(output.summary.committed_ms, 1000);
    const feedback = copy_draw(output);
    engine.acknowledge(session, token);
    engine.draw(session, 1100, viewport, output);
    assert.deepEqual(copy_draw(output), feedback);
    assert.throws(() => engine.render_reserve(session, 24, requirements.required_bytes), { code: 'ENGINE_2' });
    engine.draw(session, 1900, viewport, output);
    assert.equal(output.instances.count, 0);
    assert.equal(engine.wasm.memory.buffer, buffer);
    engine.reset_session(session);
    assert.throws(() => engine.draw(session, 500, viewport, output), { code: 'INVALID_DRAW' });
    output.engine_epoch = engine.snapshot(session, 0).summary.epoch;
    engine.draw(session, 500, viewport, output);
    assert.equal(output.instances.count, 4);
  } finally {
    engine.dispose();
  }
});

test('draw reader rejects stale attachments and stale engine epochs', async () => {
  const { engine, session, output } = await fixture();
  try {
    const requirements = engine.render_reserve(session);
    engine.render_reserve(session, requirements.required_instances, requirements.required_bytes);
    engine.draw(session, 500, viewport, output);
    const other = engine.prepare_map(map_bytes);
    const other_resources = engine.render_resources(other.map_handle);
    const wrong_output = new Draw_Output(other_resources, output.engine_epoch);
    assert.throws(() => engine.draw(session, 500, viewport, wrong_output), { code: 'INVALID_DRAW' });
    engine.reset_session(session);
    assert.throws(() => engine.draw(session, 500, viewport, output), { code: 'INVALID_DRAW' });
  } finally {
    engine.dispose();
  }
});
