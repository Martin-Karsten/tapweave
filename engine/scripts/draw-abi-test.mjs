import assert from 'node:assert/strict';
import { load_browser_runtime } from './browser-runtime.mjs';
const { Engine_Bridge, Draw_Output, Scene_Output } = await load_browser_runtime();

export function testDrawABI(wasm, native_instances) {
  const engine = new Engine_Bridge(wasm);
  try {
    const prepared = engine.prepare_map(new TextEncoder().encode('osu file format v14\n[HitObjects]\n256,192,1000,1,0'));
    const resources = engine.render_resources(prepared.map_handle);
    const session = engine.create_session(prepared.map_handle, { arena_bytes: 65536n, input_capacity: 8, batch_capacity: 8 });
    const epoch = engine.snapshot(session, 0).summary.epoch;
    engine.render_reserve(session, 24, 65536n);
    const output = new Draw_Output(resources, epoch);
    engine.draw(session, 500, { css_left: 0, css_top: 0, css_width: 512, css_height: 384, device_pixel_ratio: 1 }, output);
    const instances = new Uint8Array(wasm.memory.buffer, output.address + output.instances.offset,
      output.instances.count * output.instances.stride);
    assert.deepEqual(Array.from(instances), native_instances);
  } finally {
    engine.dispose();
  }
}

export function testSceneABI(wasm, native_instances, native_resources) {
  const engine = new Engine_Bridge(wasm);
  try {
    const prepared = engine.prepare_map(new TextEncoder().encode('osu file format v14\n[Difficulty]\nHPDrainRate:0\nCircleSize:4\nApproachRate:5\nSliderMultiplier:1.4\nSliderTickRate:1\n[TimingPoints]\n0,500,4,1,1,100,1,0\n[HitObjects]\n100,100,1000,1,0\n150,180,1500,2,0,L|380:180|150:180,2,460\n256,192,5500,8,0,7000\n'));
    const resources = engine.scene_resources(prepared.map_handle);
    // Independently require ink in the WASM atlas: native/WASM equality alone
    // would miss a shared empty-atlas regression in stroke lookup.
    const atlas = resources.summary;
    for (const glyph of [37, 43, 46, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 62, 88]) {
      let ink_texels = 0;
      for (let pixel_y = 0; pixel_y < 32; pixel_y++) {
        for (let pixel_x = 0; pixel_x < 32; pixel_x++) {
          const texel = (Math.floor(glyph / 16) * 32 + pixel_y) * atlas.atlas_width + glyph % 16 * 32 + pixel_x;
          if (resources.bytes[atlas.atlas_offset + texel * 4 + 3] > 0) ink_texels++;
        }
      }
      assert.ok(ink_texels > 0, `WASM glyph ${glyph} must contain ink`);
    }
    const normalized = resources.bytes.slice();
    new DataView(normalized.buffer).setBigUint64(8, 0n, true);
    // Byte-loop instead of deepEqual: the attachment carries the half-megabyte
    // glyph atlas, and boxed-array comparison over-allocates there.
    assert.equal(normalized.length, native_resources.length);
    let resource_mismatch = -1;
    for (let byte_index = 0; byte_index < normalized.length; byte_index++) {
      if (normalized[byte_index] !== native_resources[byte_index]) {
        resource_mismatch = byte_index;
        break;
      }
    }
    assert.equal(resource_mismatch, -1, `scene resource bytes differ at ${resource_mismatch}`);
    const session = engine.create_session(prepared.map_handle, { arena_bytes: 4194304n, input_capacity: 32, batch_capacity: 32 });
    const epoch = engine.snapshot(session, 0).summary.epoch;
    engine.scene_reserve(session, 4096, 4194304n);
    const output = new Scene_Output(resources, epoch);
    engine.scene_draw(session, 1400, { css_left: 0, css_top: 0, css_width: 512, css_height: 384, device_pixel_ratio: 1 }, output);
    const instances = new Uint8Array(wasm.memory.buffer, output.address + output.instances.offset,
      output.instances.count * output.instances.stride);
    assert.deepEqual(Array.from(instances), native_instances);
  } finally {
    engine.dispose();
  }
}
