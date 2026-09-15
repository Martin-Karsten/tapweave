import { test, expect } from '@playwright/test';

test('real Web Audio renders Odin one-shots, slider loops and shared music with bounded cleanup', async ({ page }, test_info) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { Engine_Bridge, Gameplay_Output, Voice_Output } = await import('/platform/browser-js/src/engine-bridge.js');
    const { Audio_Service } = await import('/platform/browser-js/src/audio.js');
    const { Audio_Admission } = await import('/platform/browser-js/src/audio-admission.js');
    const { Audio_Clock } = await import('/platform/browser-js/src/clock.js');
    const { Music_Transport } = await import('/platform/browser-js/src/music.js');
    const { create_fallback_audio } = await import('/platform/browser-js/src/fallback-audio.js');
    const { load_sample_assets, bind_sample_assets } = await import('/platform/browser-js/src/sample-assets.js');
    const offline = new OfflineAudioContext(2, 24000 * 3, 24000);
    // OfflineAudioContext has a suspended preparation phase. The facade exposes
    // that phase to the same executor; all nodes and automation are real Web Audio.
    const context = { currentTime: 0, state: 'running', destination: offline.destination,
      createBuffer: (...arguments_) => offline.createBuffer(...arguments_),
      createBufferSource: () => offline.createBufferSource(),
      createGain: () => offline.createGain(), createStereoPanner: () => offline.createStereoPanner() };
    const engine = await Engine_Bridge.create(await (await fetch('/tapweave.wasm')).arrayBuffer());
    const clock = new Audio_Clock();
    const audio = new Audio_Service(context, clock, { lookahead_ms: 1000 });
    const music = new Music_Transport(context, clock);
    try {
      const map = engine.prepare_map(new TextEncoder().encode('osu file format v14\n[Difficulty]\nHPDrainRate:0\nSliderMultiplier:1.4\n[TimingPoints]\n0,500\n[HitObjects]\n256,192,1000,2,0,L|396:192,1,140\n256,192,2500,1,0'));
      const samples = await load_sample_assets(map.descriptor, { async read() { return null; } }, 'map.osu', async () => {},
        engine.sample_probe(), { fallback_assets: create_fallback_audio(context) });
      const session = engine.create_session(map.map_handle, { input_capacity: 8, batch_capacity: 8 });
      const capacity = engine.voice_reserve(session);
      engine.voice_reserve(session, capacity.required_commands, capacity.required_bytes);
      bind_sample_assets(engine, session, samples);
      engine.submit_inputs(session, [
        { sequence: 1n, raw_time_ms: 1000, effective_time_ms: 1000, x: 256, y: 192, action_bits: 1 },
        { sequence: 2n, raw_time_ms: 1500, effective_time_ms: 1500, x: 396, y: 192, action_bits: 1 },
      ]);
      engine.advance_output(session, 1600, new Gameplay_Output());
      const output = engine.voice_output(session, new Voice_Output());
      clock.start(0, 0);
      clock.bind_session(session, output.summary.epoch, 0, 0);
      audio.set_assets(samples.assets);
      const admission = new Audio_Admission(engine, session, audio);
      admission.admit(output);
      const music_buffer = offline.createBuffer(1, 24000, 24000);
      const music_samples = music_buffer.getChannelData(0);
      for (let sample_index = 0; sample_index < music_samples.length; sample_index++) {
        music_samples[sample_index] = Math.sin(2 * Math.PI * 110 * sample_index / 24000) * 0.05;
      }
      music.set_buffer(music_buffer);
      music.start();
      audio.pump();
      context.currentTime = 0.6;
      audio.pump();
      const rendered = await offline.startRendering();
      // Firefox may resolve rendering before delivering queued source ended
      // events. Observe those real callbacks before asserting resource cleanup.
      const cleanup_deadline = performance.now() + 1000;
      while ((audio.voices.size || audio.retiring_voices.size) && performance.now() < cleanup_deadline) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      const channel = rendered.getChannelData(0);
      const energy = (start_seconds, end_seconds) => {
        let sum = 0;
        for (let sample_index = start_seconds * 24000; sample_index < end_seconds * 24000; sample_index++) sum += channel[sample_index] ** 2;
        return sum / ((end_seconds - start_seconds) * 24000);
      };
      const measurements = { music_energy: energy(0.1, 0.5), loop_energy: energy(1.2, 1.4),
        silence_energy: energy(2, 2.4), dispatched: audio.metrics.dispatched, pending: audio.pending.length,
        active: audio.voices.size, retiring: audio.retiring_voices.size };
      audio.cancel();
      return measurements;
    } finally { music.dispose(); audio.dispose(); engine.dispose(); }
  });
  expect(result.music_energy).toBeGreaterThan(0.0001);
  expect(result.loop_energy).toBeGreaterThan(0.0001);
  expect(result.silence_energy).toBe(0);
  expect(result.dispatched).toBeGreaterThanOrEqual(3);
  expect(result.pending).toBe(0);
  expect(result.active).toBe(0);
  expect(result.retiring).toBe(0);
  await test_info.attach('web-audio.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
});
