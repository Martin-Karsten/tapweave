import assert from 'node:assert/strict';
import { Engine_Bridge, Draw_Output } from '../../platform/browser-js/src/engine-bridge.mjs';

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
