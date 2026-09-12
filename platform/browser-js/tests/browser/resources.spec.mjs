import { test, expect } from '@playwright/test';

test('real Odin attachment uploads once, renders a diagnostic quad and recovers context', async ({ page }, test_info) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { Engine_Bridge } = await import('/platform/browser-js/src/engine-bridge.mjs');
    const { WebGL_Resources } = await import('/platform/browser-js/src/webgl-resources.mjs');
    const engine = await Engine_Bridge.create(await (await fetch('/tapweave.wasm')).arrayBuffer());
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 256;
    document.body.replaceChildren(canvas);
    const gpu = new WebGL_Resources(canvas);
    const context = canvas.getContext('webgl2');
    try {
      const map = engine.prepare_map(new TextEncoder().encode('osu file format v14\n[HitObjects]\n256,192,1000,1,0'));
      const resources = engine.render_resources(map.map_handle);
      const memory_before = engine.wasm.memory.buffer.byteLength;
      gpu.publish(resources);
      gpu.publish(resources);
      const uploads_before_loss = gpu.upload_count;
      const generation = gpu.generation;
      // Test-only explicit uniforms exercise the unchanged Odin quad shaders.
      // This is not a production primitive/animation executor.
      const draw_probe = () => {
        gpu.bind(gpu.generation, resources.summary.resource_id);
        const program = context.getParameter(context.CURRENT_PROGRAM);
        context.viewport(0, 0, 256, 256);
        context.clearColor(0, 0, 0, 1); context.clear(context.COLOR_BUFFER_BIT);
        context.uniformMatrix3fv(context.getUniformLocation(program, 'transform'), false,
          new Float32Array([0.5, 0, 0, 0, 0.5, 0, 0, 0, 1]));
        context.uniform4f(context.getUniformLocation(program, 'colour'), 0, 0.75, 1, 1);
        context.drawElements(context.TRIANGLES, 6, context.UNSIGNED_INT, 0);
        const center = new Uint8Array(4); const corner = new Uint8Array(4);
        context.readPixels(128, 128, 1, 1, context.RGBA, context.UNSIGNED_BYTE, center);
        context.readPixels(0, 0, 1, 1, context.RGBA, context.UNSIGNED_BYTE, corner);
        return { center: [...center], corner: [...corner], error: context.getError() };
      };
      const before = draw_probe();
      const extension = context.getExtension('WEBGL_lose_context');
      if (!extension) throw new Error('WEBGL_lose_context is required for this probe');
      const lost = new Promise(resolve => canvas.addEventListener('webglcontextlost', resolve, { once: true }));
      extension.loseContext(); await lost;
      const ready_while_lost = gpu.ready;
      const restored = new Promise(resolve => canvas.addEventListener('webglcontextrestored', resolve, { once: true }));
      setTimeout(() => extension.restoreContext(), 50); await restored;
      const ready_before_restore = gpu.ready;
      gpu.restore(); gpu.restore();
      let stale_code;
      try { gpu.bind(generation, resources.summary.resource_id); } catch (error) { stale_code = error.code; }
      const after = draw_probe();
      // Retain pixels in a 2D diagnostic image for screenshot inspection after
      // this evaluation (the WebGL drawing buffer need not be preserved).
      const image = document.createElement('img'); image.src = canvas.toDataURL();
      document.body.append(image);
      return { before, after, uploads_before_loss, uploads_after_loss: gpu.upload_count,
        ready_while_lost, ready_before_restore, stale_code,
        memory_unchanged: memory_before === engine.wasm.memory.buffer.byteLength };
    } finally { gpu.dispose(); engine.dispose(); }
  });
  expect(result.before).toEqual({ center: [0, 191, 255, 255], corner: [0, 0, 0, 255], error: 0 });
  expect(result.after).toEqual(result.before);
  expect(result.uploads_before_loss).toBe(1);
  expect(result.uploads_after_loss).toBe(2);
  expect(result.ready_while_lost).toBe(false);
  expect(result.ready_before_restore).toBe(false);
  expect(result.stale_code).toBe('INVALID_STATE');
  expect(result.memory_unchanged).toBe(true);
  await page.locator('img').screenshot({ path: test_info.outputPath('resource-quad.png') });
});

test('bound programs and shaders are released on replacement and disposal', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { Engine_Bridge } = await import('/platform/browser-js/src/engine-bridge.mjs');
    const { WebGL_Resources } = await import('/platform/browser-js/src/webgl-resources.mjs');
    const engine = await Engine_Bridge.create(await (await fetch('/tapweave.wasm')).arrayBuffer());
    const canvas = document.createElement('canvas');
    const gpu = new WebGL_Resources(canvas);
    const context = canvas.getContext('webgl2');
    try {
      const map = engine.prepare_map(new TextEncoder().encode('osu file format v14\n[HitObjects]\n256,192,1000,1,0'));
      const resources = engine.render_resources(map.map_handle);
      gpu.publish(resources);
      gpu.bind(gpu.generation, resources.summary.resource_id);
      const original_program = context.getParameter(context.CURRENT_PROGRAM);
      const original_shaders = context.getAttachedShaders(original_program);
      const invalid = { bytes: resources.bytes.slice() };
      invalid.bytes[resources.summary.vertex_shader_offset] = 33;
      let failure_code;
      try { gpu.publish(invalid); } catch (error) { failure_code = error.code; }
      const rollback_preserved_program = context.getParameter(context.CURRENT_PROGRAM) === original_program &&
        context.isProgram(original_program) && original_shaders.every(shader => context.isShader(shader));
      const replacement = { bytes: resources.bytes.slice() };
      replacement.bytes[resources.summary.atlas_offset] = 0;
      gpu.publish(replacement);
      const replacement_released_program = !context.isProgram(original_program) &&
        original_shaders.every(shader => !context.isShader(shader));
      gpu.bind(gpu.generation, resources.summary.resource_id);
      const replacement_program = context.getParameter(context.CURRENT_PROGRAM);
      const replacement_shaders = context.getAttachedShaders(replacement_program);
      gpu.dispose();
      gpu.dispose();
      return { failure_code, rollback_preserved_program, replacement_released_program,
        disposal_released_program: !context.isProgram(replacement_program) &&
          replacement_shaders.every(shader => !context.isShader(shader)),
        no_current_program: context.getParameter(context.CURRENT_PROGRAM) === null,
        error: context.getError() };
    } finally { gpu.dispose(); engine.dispose(); }
  });
  expect(result).toEqual({ failure_code: 'RENDER_RESOURCE_FAILED', rollback_preserved_program: true,
    replacement_released_program: true, disposal_released_program: true, no_current_program: true, error: 0 });
});
