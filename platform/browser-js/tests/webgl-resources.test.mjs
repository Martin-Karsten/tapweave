import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { schema } from '../../../engine/abi/records.mjs';
import { Engine_Bridge, Scene_Output } from '../build/engine-bridge.js';
import { WebGL_Resources, RESOURCE_LIMITS } from '../build/webgl-resources.js';

const wasm_bytes = await readFile(new URL('../../../engine/artifacts/tapweave.wasm', import.meta.url));

function fake_canvas() {
  const live = new Set();
  const listeners = new Map();
  let allocation_count = 0;
  const context = { NO_ERROR: 0, MAX_TEXTURE_SIZE: 1, lost: false, fail_at: 0,
    compile: true, link: true, upload_error: false, error: 0, uploads: 0,
    isContextLost() { return this.lost; },
    getError() { const error = this.error; this.error = 0; return error; },
    getParameter() { return 4096; },
    getShaderParameter() { return this.compile; },
    getProgramParameter() { return this.link; },
    getShaderInfoLog() { return 'shader diagnostic'; },
    getProgramInfoLog() { return 'link diagnostic'; },
    bufferData() { this.uploads++; if (this.upload_error) this.error = 1285; },
  };
  for (const resource_name of ['Shader', 'Program', 'Buffer', 'Texture', 'VertexArray', 'Query']) {
    context['create' + resource_name] = () => {
      allocation_count++;
      if (allocation_count === context.fail_at) return null;
      const resource = { resource_name }; live.add(resource); return resource;
    };
    context['delete' + resource_name] = resource => live.delete(resource);
  }
  for (const operation of ['shaderSource', 'compileShader', 'attachShader', 'linkProgram', 'bindVertexArray',
    'bindBuffer', 'enableVertexAttribArray', 'vertexAttribPointer', 'activeTexture', 'bindTexture',
    'texParameteri', 'texImage2D', 'useProgram']) context[operation] = () => {};
  return { context, live, listeners, get allocations() { return allocation_count; },
    getContext: () => context,
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: name => listeners.delete(name),
    lose() { context.lost = true; live.clear(); listeners.get('webglcontextlost')({ preventDefault() {} }); },
    restore() { context.lost = false; listeners.get('webglcontextrestored')(); },
  };
}

async function with_resources(run) {
  const engine = await Engine_Bridge.create(wasm_bytes);
  try {
    const map = engine.prepare_map(new TextEncoder().encode('osu file format v14\n[HitObjects]\n256,192,1000,1,0'));
    await run(engine.render_resources(map.map_handle));
  } finally { engine.dispose(); }
}

test('WebGL2 unavailable is explicit', () => {
  assert.throws(() => new WebGL_Resources({ getContext: () => null }), { code: 'CAP_RENDER_UNAVAILABLE' });
});

test('publication reuses uploads, owns recovery bytes and rejects stale generations/disposal', async () => {
  await with_resources(resources => {
    const canvas = fake_canvas();
    const gpu = new WebGL_Resources(canvas);
    gpu.publish(resources);
    const allocated = canvas.allocations;
    for (let publication_index = 0; publication_index < 100; publication_index++) gpu.publish(resources);
    assert.equal(gpu.upload_count, 1);
    assert.equal(canvas.allocations, allocated);
    const generation = gpu.generation;
    gpu.bind(generation, resources.summary.resource_id);
    resources.bytes.fill(0); // Recovery owns a separate validated copy.
    canvas.lose();
    assert.equal(gpu.ready, false);
    assert.throws(() => gpu.restore(), { code: 'CAP_RENDER_UNAVAILABLE' });
    canvas.restore();
    assert.equal(gpu.ready, false);
    gpu.restore();
    gpu.restore();
    assert.equal(gpu.upload_count, 2);
    assert.throws(() => gpu.bind(generation, resources.summary.resource_id), { code: 'INVALID_STATE' });
    gpu.bind(gpu.generation, resources.summary.resource_id);
    gpu.dispose(); gpu.dispose();
    assert.equal(canvas.live.size, 0);
    assert.equal(canvas.listeners.size, 0);
    assert.throws(() => gpu.restore(), { code: 'INVALID_STATE' });
  });
});

test('every GPU allocation failure preserves the published resource and releases candidates', async () => {
  await with_resources(resources => {
    for (let failure_index = 1; failure_index <= 7; failure_index++) {
      const canvas = fake_canvas();
      const gpu = new WebGL_Resources(canvas);
      gpu.publish(resources);
      const live_count = canvas.live.size;
      const replacement = { bytes: resources.bytes.slice() };
      replacement.bytes[resources.summary.atlas_offset] = 0;
      canvas.context.fail_at = canvas.allocations + failure_index;
      assert.throws(() => gpu.publish(replacement), { code: 'RENDER_RESOURCE_FAILED' });
      assert.equal(canvas.live.size, live_count);
      assert.equal(gpu.ready, true);
      assert.equal(gpu.upload_count, 1);
      gpu.bind(gpu.generation, resources.summary.resource_id);
      gpu.dispose();
      assert.equal(canvas.live.size, 0);
    }
  });
});

test('compile, link and upload failures roll back and allow retry', async () => {
  await with_resources(resources => {
    for (const failure of ['compile', 'link', 'upload_error']) {
      const canvas = fake_canvas();
      const gpu = new WebGL_Resources(canvas);
      gpu.publish(resources);
      const replacement = { bytes: resources.bytes.slice() };
      replacement.bytes[resources.summary.atlas_offset] = 0;
      canvas.context[failure] = failure === 'upload_error';
      assert.throws(() => gpu.publish(replacement), error => {
        assert.equal(error.code, 'RENDER_RESOURCE_FAILED');
        if (failure !== 'upload_error') {
          assert.deepEqual(error.details, failure === 'compile'
            ? { stage: 'vertex_shader', info_log: 'shader diagnostic' }
            : { stage: 'link', info_log: 'link diagnostic' });
        }
        return true;
      });
      assert.equal(canvas.live.size, 7);
      assert.equal(gpu.upload_count, 1);
      canvas.context[failure] = failure !== 'upload_error';
      gpu.publish(replacement);
      assert.equal(gpu.upload_count, 2);
      assert.equal(canvas.live.size, 7);
      gpu.dispose();
      assert.equal(canvas.live.size, 0);
    }
  });
});

test('malformed and excessive resources reject before GPU work', async () => {
  await with_resources(resources => {
    const canvas = fake_canvas();
    const gpu = new WebGL_Resources(canvas);
    assert.throws(() => gpu.publish({ bytes: new Uint8Array(RESOURCE_LIMITS.bytes + 1) }), { code: 'QUOTA_EXCEEDED' });
    const invalid = { bytes: resources.bytes.slice() };
    new DataView(invalid.bytes.buffer).setFloat64(resources.summary.vertices_offset, Number.MAX_VALUE, true);
    assert.throws(() => gpu.publish(invalid), { code: 'INVALID_RESOURCE' });
    assert.equal(canvas.allocations, 0);
    gpu.dispose();
  });
});

// Repack a structurally valid attachment so each independent admission limit
// reaches the GPU service rather than failing the wire reader first.
function repack(resources, span_name, byte_count, atlas_width = 1) {
  const record = schema.records.find(record => record.kind === 35);
  const spans = ['vertices', 'indices', 'atlas', 'vertex_shader', 'fragment_shader'];
  const parts = spans.map(name => name === span_name ? new Uint8Array(byte_count) :
    resources.bytes.slice(resources.summary[name + '_offset'],
      resources.summary[name + '_offset'] + resources.summary[name + '_count'] * resources.summary[name + '_stride']));
  const bytes = new Uint8Array(record.size + parts.reduce((total, part) => total + Math.ceil(part.length / 8) * 8, 0));
  bytes.set(resources.bytes.subarray(0, record.size));
  const view = new DataView(bytes.buffer);
  const set_field = (name, number) => view.setUint32(record.fields[name][0], number, true);
  let offset = record.size;
  for (let span_index = 0; span_index < spans.length; span_index++) {
    const name = spans[span_index];
    const part = parts[span_index];
    set_field(name + '_offset', offset);
    set_field(name + '_count', part.length / resources.summary[name + '_stride']);
    bytes.set(part, offset);
    offset += Math.ceil(part.length / 8) * 8;
  }
  set_field('atlas_width', atlas_width);
  view.setBigUint64(record.fields.total_bytes[0], BigInt(bytes.length), true);
  return { bytes };
}

test('independent geometry, atlas and shader quotas reject before GPU allocation', async () => {
  await with_resources(resources => {
    const canvas = fake_canvas();
    const gpu = new WebGL_Resources(canvas);
    for (const oversized of [repack(resources, 'vertices', (RESOURCE_LIMITS.vertices + 1) * 16),
      repack(resources, 'indices', (RESOURCE_LIMITS.indices + 3) * 4),
      repack(resources, 'atlas', (RESOURCE_LIMITS.atlas_dimension + 1) * 4, RESOURCE_LIMITS.atlas_dimension + 1),
      repack(resources, 'vertex_shader', RESOURCE_LIMITS.shader_bytes + 1)]) {
      assert.throws(() => gpu.publish(oversized), { code: 'QUOTA_EXCEEDED' });
    }
    const invalid_utf8 = { bytes: resources.bytes.slice() };
    invalid_utf8.bytes[resources.summary.vertex_shader_offset] = 255;
    assert.throws(() => gpu.publish(invalid_utf8), { code: 'INVALID_RESOURCE' });
    assert.equal(canvas.allocations, 0);
    gpu.publish(repack(resources, 'vertices', RESOURCE_LIMITS.vertices * 16));
    assert.equal(gpu.ready, true);
    assert.throws(() => gpu.bind(gpu.generation, resources.summary.resource_id + 1n), { code: 'INVALID_STATE' });
    gpu.dispose();
    assert.equal(canvas.live.size, 0);
  });
});

test('failed context rebuild retains bytes for retry; context limits reject without publication', async () => {
  await with_resources(resources => {
    const canvas = fake_canvas();
    const gpu = new WebGL_Resources(canvas);
    canvas.context.getParameter = () => 0;
    assert.throws(() => gpu.publish(resources), { code: 'CAP_RENDER_UNAVAILABLE' });
    assert.equal(canvas.allocations, 0);
    canvas.context.getParameter = () => 4096;
    gpu.publish(resources);
    canvas.lose(); canvas.restore();
    canvas.context.fail_at = canvas.allocations + 1;
    assert.throws(() => gpu.restore(), { code: 'RENDER_RESOURCE_FAILED' });
    assert.equal(gpu.ready, false);
    assert.equal(canvas.live.size, 0);
    gpu.restore();
    assert.equal(gpu.ready, true);
    assert.equal(gpu.upload_count, 2);
    gpu.dispose();
    assert.equal(canvas.live.size, 0);
  });
});


test('scene timer queries discard all pending disjoint intervals without GPU allocations during submission', async () => {
  const engine = await Engine_Bridge.create(wasm_bytes);
  const canvas = fake_canvas();
  const context = canvas.context;
  const timer = { TIME_ELAPSED_EXT: 101, GPU_DISJOINT_EXT: 102 };
  let disjoint = false;
  context.QUERY_RESULT_AVAILABLE = 103;
  context.QUERY_RESULT = 104;
  context.getExtension = () => timer;
  context.getUniformLocation = () => ({});
  context.getContextAttributes = () => ({ stencil: true });
  context.getParameter = parameter => parameter === timer.GPU_DISJOINT_EXT ? disjoint : 4096;
  context.getQueryParameter = (query, parameter) => parameter === context.QUERY_RESULT_AVAILABLE ? true : 12500000;
  for (const operation of ['beginQuery', 'endQuery', 'viewport', 'disable', 'enable', 'stencilMask', 'clearStencil',
    'clearColor', 'clear', 'blendEquation', 'blendFunc', 'uniform4f', 'uniform1i', 'bufferSubData',
    'stencilFunc', 'stencilOp', 'vertexAttribDivisor', 'drawElementsInstanced']) context[operation] = () => {};
  const gpu = new WebGL_Resources(canvas);
  try {
    const map = engine.prepare_map(new TextEncoder().encode('osu file format v14\n[HitObjects]\n256,192,1000,1,0'));
    const resources = engine.scene_resources(map.map_handle);
    const session = engine.create_session(map.map_handle, { input_capacity: 8, batch_capacity: 8 });
    const capacity = engine.scene_reserve(session);
    engine.scene_reserve(session, capacity.required_instances, capacity.required_bytes);
    gpu.reserve(capacity.required_instances);
    gpu.publish(resources);
    const output = new Scene_Output(resources, capacity.epoch);
    const viewport = { css_left: 0, css_top: 0, css_width: 512, css_height: 384, device_pixel_ratio: 1 };
    engine.scene_draw(session, 500, viewport, output);
    const allocations = canvas.allocations;
    const execute = () => gpu.execute(output, viewport, capacity.epoch, gpu.generation);
    for (let query_index = 0; query_index < 4; query_index++) execute();
    disjoint = true;
    execute();
    disjoint = false;
    for (let query_index = 0; query_index < 4; query_index++) execute();
    assert.equal(gpu.metrics.gpu_ms, null);
    assert.equal(gpu.metrics.gpu_sequence, 0);
    execute();
    assert.equal(gpu.metrics.gpu_ms, 12.5);
    assert.equal(gpu.metrics.gpu_sequence, 1);
    assert.equal(canvas.allocations, allocations);
    canvas.lose();
    assert.equal(canvas.live.size, 0);
    canvas.restore();
    gpu.restore();
    gpu.reserve(capacity.required_instances);
    assert.equal(gpu.metrics.gpu_ms, null);
    execute();
  } finally { gpu.dispose(); engine.dispose(); }
  assert.equal(canvas.live.size, 0);
});
