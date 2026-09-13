import { test, expect } from '@playwright/test';

// Complete production scene path. Test time is explicit; this creates no second
// gameplay clock and does not enable the player UI.
test('mixed scene executes, rejects malformed frames before submission, resizes and restores', async ({ page }, test_info) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { Engine_Bridge } = await import('/platform/browser-js/src/engine-bridge.js');
    const { Renderer } = await import('/platform/browser-js/src/renderer.js');
    const { schema } = await import('/engine/abi/records.mjs');
    const engine = await Engine_Bridge.create(await (await fetch('/tapweave.wasm')).arrayBuffer());
    const canvas = document.createElement('canvas');
    canvas.style.width = '768px'; canvas.style.height = '576px';
    document.body.replaceChildren(canvas);
    let loss_count = 0;
    const map = engine.prepare_map(new TextEncoder().encode(`osu file format v14
[Difficulty]
HPDrainRate:0
[TimingPoints]
0,500,4,1,1,100,1,0
[HitObjects]
100,100,1000,1,0
150,180,1500,2,0,L|380:180|150:180,2,460
256,192,5500,8,0,7000`));
    const session = engine.create_session(map.map_handle, { input_capacity: 32, batch_capacity: 32 });
    const epoch = engine.snapshot(session, 0).summary.epoch;
    const renderer = new Renderer(engine, session, map.map_handle, canvas, epoch, () => loss_count++);
    const viewport = { css_left: 0, css_top: 0, css_width: 768, css_height: 576, device_pixel_ratio: 1 };
    const context = canvas.getContext('webgl2');
    const sample = () => {
      const pixels = new Uint8Array(canvas.width * canvas.height * 4);
      context.readPixels(0, 0, canvas.width, canvas.height, context.RGBA, context.UNSIGNED_BYTE, pixels);
      let coloured = 0, checksum = 0;
      for (let pixel_index = 0; pixel_index < pixels.length; pixel_index += 4) {
        if (pixels[pixel_index] > 40 || pixels[pixel_index + 1] > 40 || pixels[pixel_index + 2] > 40) coloured++;
        checksum = (checksum + pixels[pixel_index] * 3 + pixels[pixel_index + 1] * 5 + pixels[pixel_index + 2] * 7) >>> 0;
      }
      return { coloured, checksum, error: context.getError() };
    };
    try {
      renderer.render(1400, viewport, epoch);
      const before = sample();
      const screenshot = document.createElement('img'); screenshot.src = canvas.toDataURL();
      document.body.append(screenshot);
      const frame = renderer.output;
      const alpha_offset = schema.records.find(record => record.kind === 50).fields.alpha[0];
      frame.view.setFloat64(frame.address + frame.instances.offset + (frame.instances.count - 1) * frame.instances.stride + alpha_offset, NaN, true);
      let rejection;
      try { renderer.gpu.execute(frame, viewport, epoch, renderer.gpu.generation); } catch (error) { rejection = error.code; }
      const after_invalid = sample();
      renderer.render(6000, viewport, epoch);
      const spinner = sample();
      renderer.render(1400, { ...viewport, device_pixel_ratio: 2 }, epoch);
      const resized = [canvas.width, canvas.height];
      renderer.render(1400, viewport, epoch);
      const generation = renderer.gpu.generation;
      const extension = context.getExtension('WEBGL_lose_context');
      const lost = new Promise(resolve => canvas.addEventListener('webglcontextlost', resolve, { once: true }));
      extension.loseContext(); await lost;
      const unavailable = !renderer.ready;
      const restored = new Promise(resolve => canvas.addEventListener('webglcontextrestored', resolve, { once: true }));
      setTimeout(() => extension.restoreContext(), 50); await restored;
      renderer.restore();
      renderer.render(1400, viewport, epoch);
      const after = sample();
      let stale;
      try { renderer.gpu.execute(renderer.output, viewport, epoch, generation); } catch (error) { stale = error.code; }
      return { before, spinner, rejection, after_invalid, after, resized, loss_count, unavailable, stale,
        uploads: renderer.gpu.upload_count };
    } finally { renderer.dispose(); engine.dispose(); }
  });
  expect(result.before.error).toBe(0);
  expect(result.before.coloured).toBeGreaterThan(1000);
  expect(result.spinner.error).toBe(0);
  expect(result.spinner.coloured).toBeGreaterThan(1000);
  expect(result.rejection).toBe('INVALID_DRAW');
  expect(result.after_invalid).toEqual(result.before);
  expect(result.after).toEqual(result.before);
  expect(result.resized).toEqual([1536, 1152]);
  expect(result.loss_count).toBe(1);
  expect(result.unavailable).toBe(true);
  expect(result.stale).toBe('INVALID_DRAW');
  expect(result.uploads).toBe(2);
  await page.locator('img').screenshot({ path: test_info.outputPath('mixed-scene.png') });
});
