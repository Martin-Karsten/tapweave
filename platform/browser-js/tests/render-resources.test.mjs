import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Engine_Bridge } from '../src/engine-bridge.mjs';
import { Render_Resources } from '../src/render-resources.mjs';
import { schema } from '../../../engine/abi/records.mjs';

const wasm_bytes = await readFile(new URL('../../../engine/artifacts/tapweave.wasm', import.meta.url));
test('render resource reader rejects malformed spans and geometry before publication', async () => {
  const engine = await Engine_Bridge.create(wasm_bytes);
  try {
    const prepared = engine.prepare_map(new TextEncoder().encode('osu file format v14\n[HitObjects]\n256,192,1000,1,0'));
    const resources = engine.render_resources(prepared.map_handle);
    const fields = schema.records.find(record => record.kind === 35).fields;
    for (const [field, number] of [['vertices_offset', 0], ['indices_offset', resources.summary.vertices_offset],
      ['atlas_count', 3], ['vertex_shader_count', 0xffffffff], ['attachment_version', 2], ['flags', 1]]) {
      const bytes = resources.bytes.slice();
      new DataView(bytes.buffer).setUint32(fields[field][0], number, true);
      assert.throws(() => new Render_Resources(bytes), { code: 'INVALID_RESOURCE' });
    }
    const bad_index = resources.bytes.slice();
    new DataView(bad_index.buffer).setUint32(resources.summary.indices_offset, resources.summary.vertices_count, true);
    assert.throws(() => new Render_Resources(bad_index), { code: 'INVALID_RESOURCE' });
    const bad_vertex = resources.bytes.slice();
    new DataView(bad_vertex.buffer).setFloat64(resources.summary.vertices_offset, NaN, true);
    assert.throws(() => new Render_Resources(bad_vertex), { code: 'INVALID_RESOURCE' });
    assert.throws(() => new Render_Resources(resources.bytes.slice(0, 159)));
    assert.deepEqual(engine.render_resources(prepared.map_handle).bytes, resources.bytes);
  } finally {
    engine.dispose();
  }
});
