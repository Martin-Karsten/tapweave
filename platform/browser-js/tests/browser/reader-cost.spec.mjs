import { test, expect } from '@playwright/test';
import { writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

test('measure reusable production readers with Chromium heap sampling', async ({ page, browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'CDP allocation sampling is Chromium-specific.');
  await page.goto('/');
  await page.evaluate(async () => {
    const { Engine_Bridge, Draw_Output, Voice_Output } = await import('/platform/browser-js/src/engine-bridge.mjs');
    const engine = await Engine_Bridge.create(await (await fetch('/tapweave.wasm')).arrayBuffer());
    const prepared = engine.prepare_map(new TextEncoder().encode('osu file format v14\n[HitObjects]\n256,192,1000,1,0'));
    const resources = engine.render_resources(prepared.map_handle);
    const session = engine.create_session(prepared.map_handle, { input_capacity: 8, batch_capacity: 8 });
    const capacity = engine.render_reserve(session);
    engine.render_reserve(session, capacity.required_instances, capacity.required_bytes);
    const voice_capacity = engine.voice_reserve(session);
    engine.voice_reserve(session, voice_capacity.required_commands, voice_capacity.required_bytes);
    window.reader_measurement = { engine, session, draw: new Draw_Output(resources, 1), voice: new Voice_Output(),
      viewport: { css_left: 0, css_top: 0, css_width: 512, css_height: 384, device_pixel_ratio: 1 }, record: {} };
  });
  const connection = await page.context().newCDPSession(page);
  await connection.send('HeapProfiler.startSampling', { samplingInterval: 512,
    includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
  const measurement = await page.evaluate(() => {
    const { engine, session, draw, voice, viewport, record } = window.reader_measurement;
    const memory_bytes = engine.wasm.memory.buffer.byteLength;
    const durations = [];
    for (let frame_index = 0; frame_index < 5000; frame_index++) {
      const started = performance.now();
      engine.draw(session, 500, viewport, draw);
      for (let instance_index = 0; instance_index < draw.instances.count; instance_index++) {
        draw.record_into(draw.instances, instance_index, record);
      }
      engine.voice_output(session, voice);
      durations.push((performance.now() - started) * 1e6);
    }
    return { iterations: durations.length, memory_before: memory_bytes, memory_after: engine.wasm.memory.buffer.byteLength,
      draw_bytes: Number(draw.summary.total_bytes), voice_bytes: Number(voice.summary.total_bytes), durations_ns: durations };
  });
  const { profile } = await connection.send('HeapProfiler.stopSampling');
  await connection.detach();
  await page.evaluate(() => { window.reader_measurement.engine.dispose(); delete window.reader_measurement; });
  expect(measurement.memory_after).toBe(measurement.memory_before);
  const allocations = [];
  const visit = node => {
    if (node.selfSize > 0 && /(?:engine-bridge|voice-output|records)\.mjs/.test(node.callFrame.url)) {
      allocations.push({ function: node.callFrame.functionName, url: node.callFrame.url,
        line: node.callFrame.lineNumber + 1, sampled_bytes: node.selfSize });
    }
    for (const child of node.children) visit(child);
  };
  visit(profile.head);
  const { durations_ns, ...counts } = measurement;
  durations_ns.sort((left, right) => left - right);
  const profile_bytes = JSON.stringify(profile);
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  await writeFile(new URL('../../../../engine/artifacts/reader-allocation-profile.json', import.meta.url), profile_bytes);
  await writeFile(new URL('../../../../engine/reference/findings/m3-reader-cost.json', import.meta.url), JSON.stringify({
    schema_version: 1, command: 'npm --prefix platform/browser-js run test:browser -- --project=chromium',
    browser: browser.version(), sampling_interval_bytes: 512, includes_collected_objects: true,
    profile_sha256: digest(profile_bytes), wasm_sha256: digest(await readFile(new URL('../../../../engine/artifacts/tapweave.wasm', import.meta.url))),
    ...counts, sampled_reader_bytes: allocations.reduce((sum, allocation) => sum + allocation.sampled_bytes, 0), allocations,
    timings: Object.fromEntries([50, 95, 99].map(percentile => [`p${percentile}_ns`, durations_ns[Math.ceil(durations_ns.length * percentile / 100) - 1]])),
    limitations: ['Statistical allocation samples include collected objects; they are not an exact allocation count',
      'Profiling overhead and timer resolution affect timings; no W09 approval implied',
      'Repeated single-circle draw and empty voice reads; complete scene workloads remain checkpoint 6'],
  }, null, 2) + '\n');
});
