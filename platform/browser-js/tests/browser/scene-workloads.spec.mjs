import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const full_matrix = process.env.TAPWEAVE_RENDERER_MATRIX === '1';
for (const workload_id of ['tiny', 'dense', 'long-overlap', '10000-objects', 'three-minute-mixed']) {
for (const cadence of full_matrix ? [30, 60, 120, 144] : [60]) {
test(`renderer workload ${workload_id} at ${cadence} Hz (${full_matrix ? 'full stalls' : 'smoke'})`, async ({ page }, test_info) => {
  test.setTimeout(600000);
  page.on('console', message => { if (message.text().startsWith('renderer-workload:')) console.log(message.text()); });
  await page.goto('/');
  const report = await page.evaluate(async ({ workload_id, cadence, full_matrix }) => {
    const { Engine_Bridge, Gameplay_Output } = await import('/platform/browser-js/src/engine-bridge.js');
    const { Renderer } = await import('/platform/browser-js/src/renderer.js');
    const wasm = await (await fetch('/tapweave.wasm')).arrayBuffer();
    const viewport = { css_left: 0, css_top: 0, css_width: 512, css_height: 384, device_pixel_ratio: 1 };
    const header = 'osu file format v14\n[Difficulty]\nHPDrainRate:0\nSliderMultiplier:1.4\n[TimingPoints]\n0,500,4,1,1,100,1,0\n[HitObjects]\n';
    const workloads = [
      { id: 'tiny', duration: 3000, objects: ['100,100,1000,1,0', '150,180,1500,2,0,L|380:180,1,230', '256,192,2200,8,0,2800'] },
      { id: 'dense', duration: 3000, objects: Array.from({ length: 256 }, (_, object_index) => `${64 + object_index % 16 * 25},${64 + Math.floor(object_index / 16) * 16},${1000 + object_index % 8 * 20},1,0`) },
      { id: 'long-overlap', duration: 12000, objects: Array.from({ length: 24 }, (_, object_index) => `64,${64 + object_index * 10},1000,2,0,L|448:${64 + object_index * 10}|64:${64 + object_index * 10},3,768`) },
      { id: '10000-objects', duration: 3000, objects: Array.from({ length: 10000 }, (_, object_index) => `${64 + object_index % 16 * 25},${64 + object_index % 12 * 20},${1000 + object_index * 100},1,0`) },
      { id: 'three-minute-mixed', duration: 180000, objects: Array.from({ length: 180 }, (_, object_index) => object_index % 3 === 0
        ? `100,100,${object_index * 1000 + 1000},1,0` : object_index % 3 === 1
          ? `150,180,${object_index * 1000 + 1000},2,0,L|380:180,1,230`
          : `256,192,${object_index * 1000 + 1000},8,0,${object_index * 1000 + 1800}`) },
    ];
    const findings = [];
    const percentile = samples => {
      if (!samples.length) return null;
      samples.sort((left, right) => left - right);
      return { p50: samples[Math.floor(samples.length * .5)] ?? 0, p95: samples[Math.floor(samples.length * .95)] ?? 0,
        p99: samples[Math.floor(samples.length * .99)] ?? 0 };
    };
    for (const workload of workloads.filter(candidate => candidate.id === workload_id)) {
      const engine = await Engine_Bridge.create(wasm);
      const prepare_started = performance.now();
      const map = engine.prepare_map(new TextEncoder().encode(header + workload.objects.join('\n')));
      const session = engine.create_session(map.map_handle, { input_capacity: 1024, batch_capacity: 1024 });
      const gameplay_output = new Gameplay_Output();
      const canvas = document.createElement('canvas');
      const epoch = engine.snapshot(session, 0).summary.epoch;
      const renderer = new Renderer(engine, session, map.map_handle, canvas, epoch, () => {});
      const prepare_ms = performance.now() - prepare_started;
      const context = canvas.getContext('webgl2');
      const debug_renderer = context.getExtension('WEBGL_debug_renderer_info');
      const renderer_name = debug_renderer ? context.getParameter(debug_renderer.UNMASKED_RENDERER_WEBGL) : context.getParameter(context.RENDERER);
      const stages = { simulation: [], presentation: [], validation: [], upload: [], submission: [], gpu: [] };
      let previous_gpu_sequence = 0;
      let peak_instances = 0, peak_commands = 0, frames = 0;
      const memory_before = engine.wasm.memory.buffer.byteLength;
      try {
        // Explicit virtual cadence/stalls. This measures production submission;
        // the separate RAF sample below measures real browser pacing.
        for (const stall of full_matrix ? [0, 50, 100, 250] : [100]) {
            engine.reset_session(session);
            const current_epoch = engine.snapshot(session, 0).summary.epoch;
            for (let frame_index = 0; frame_index * 1000 / cadence <= workload.duration; frame_index++) {
              const time_ms = frame_index * 1000 / cadence;
              if (time_ms > 990 && time_ms < 990 + stall) continue;
              const simulation_started = performance.now();
              engine.advance_output(session, time_ms, gameplay_output);
              const simulation_ms = performance.now() - simulation_started;
              if (gameplay_output.summary.batch_token) engine.acknowledge(session, gameplay_output.summary.batch_token);
              renderer.render(time_ms, viewport, current_epoch);
              if (renderer.gpu.metrics.gpu_sequence !== previous_gpu_sequence) {
                if (renderer.gpu.metrics.gpu_ms !== null) stages.gpu.push(renderer.gpu.metrics.gpu_ms);
                previous_gpu_sequence = renderer.gpu.metrics.gpu_sequence;
              }
              // Bounded measurement sampling; test arrays are not player allocations.
              if (frame_index % 20 === 0) {
                stages.simulation.push(simulation_ms);
                stages.presentation.push(renderer.presentation_ms);
                stages.validation.push(renderer.gpu.metrics.validation_ms);
                stages.upload.push(renderer.gpu.metrics.upload_ms);
                stages.submission.push(renderer.gpu.metrics.submission_ms);
              }
              peak_instances = Math.max(peak_instances, renderer.gpu.metrics.instances);
              peak_commands = Math.max(peak_commands, renderer.gpu.metrics.commands);
              frames++;
              // Allow asynchronous query results to become visible. This is a
              // harness yield, not a renderer clock or loaded pacing sample.
              if (frame_index % 120 === 0) await new Promise(resolve => setTimeout(resolve, 0));
            }
        }
        findings.push({ workload: workload.id, renderer_name, cadence, stalls: full_matrix ? [0, 50, 100, 250] : [100], gpu_samples: stages.gpu.length, prepare_ms, frames, capacity: renderer.instance_capacity, peak_instances, peak_commands,
          static_bytes: renderer.gpu.metrics.static_bytes, wasm_bytes: memory_before,
          no_growth: engine.wasm.memory.buffer.byteLength === memory_before, uploads: renderer.gpu.upload_count,
          timings_ms: Object.fromEntries(Object.entries(stages).map(([stage, samples]) => [stage, percentile(samples)])) });
        console.info('renderer-workload:' + workload.id + ':' + frames);
      } finally { renderer.dispose(); engine.dispose(); }
    }
    const raf_intervals = [];
    let previous_time;
    for (let frame_index = 0; frame_index < 120; frame_index++) {
      const timestamp = await new Promise(resolve => requestAnimationFrame(resolve));
      if (previous_time !== undefined) raf_intervals.push(timestamp - previous_time);
      previous_time = timestamp;
    }
    return { user_agent: navigator.userAgent, classification: 'local-renderer-measurements-unapproved-baseline',
      coverage: full_matrix ? 'one workload/cadence with full stall cases' : 'smoke only; full cadence/stall matrix not run',
      gpu_time: 'asynchronous disjoint timer queries when available; inspect gpu_samples', raf_idle_ms: percentile(raf_intervals), findings };
  }, { workload_id, cadence, full_matrix });
  for (const finding of report.findings) {
    expect(finding.no_growth).toBe(true);
    expect(finding.uploads).toBe(1);
    expect(finding.peak_instances).toBeLessThanOrEqual(finding.capacity);
  }
  await writeFile(test_info.outputPath('renderer-workloads.json'), JSON.stringify(report, null, 2));
});

}
}
