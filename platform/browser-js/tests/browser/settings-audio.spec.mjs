import { test, expect } from '@playwright/test';

test('real output mixer independently scales music and effects without changing source schedules', async ({ page }, test_info) => {
  await page.goto('/');
  const measurements = await page.evaluate(async () => {
    const { Audio_Mixer } = await import('/platform/browser-js/src/audio-mixer.js');
    const { Audio_Service } = await import('/platform/browser-js/src/audio.js');
    const { Music_Transport } = await import('/platform/browser-js/src/music.js');
    const { Audio_Clock } = await import('/platform/browser-js/src/clock.js');
    const { DEFAULT_PLAYER_SETTINGS } = await import('/platform/browser-js/src/player-settings.js');
    const measurements = [];
    for (const [music_volume, effects_volume] of [[100, 100], [0, 100], [100, 0], [50, 25]]) {
      const offline = new OfflineAudioContext(2, 48000, 24000);
      const context = { currentTime: 0, state: 'running', destination: offline.destination,
        createGain: () => offline.createGain(), createBufferSource: () => offline.createBufferSource(),
        createStereoPanner: () => offline.createStereoPanner() };
      const mixer = new Audio_Mixer(context, { ...DEFAULT_PLAYER_SETTINGS, music_volume, effects_volume });
      const clock = new Audio_Clock();
      clock.start(0, 0);
      const music = new Music_Transport(context, clock, mixer.music);
      const effects = new Audio_Service(context, clock, { lookahead_ms: 1000 }, mixer.effects);
      const buffer = offline.createBuffer(1, 12000, 24000);
      buffer.getChannelData(0).fill(.2);
      try {
        music.set_buffer(buffer); music.start();
        effects.set_assets(new Map([[1n, buffer]]));
        effects.enqueue([{ sequence: 1n, epoch: clock.epoch, kind: 'one_shot', policy: 'drop',
          beatmap_time_ms: 1000, duration_ms: 0, voice_id: 1n, asset_id: 1n,
          volume: 1, pan: 0, rate: 1, lateness_threshold_ms: 50 }]);
        effects.pump();
        const rendered = await offline.startRendering();
        const channel = rendered.getChannelData(0);
        measurements.push({ music_volume, effects_volume, music: channel[6000], effects: channel[30000],
          silence: channel[45000], dispatched: effects.metrics.dispatched });
      } finally { music.dispose(); effects.dispose(); mixer.dispose(); }
    }
    return measurements;
  });
  const [full, music_muted, effects_muted, scaled] = measurements;
  expect(full.music).toBeGreaterThan(0); expect(full.effects).toBeGreaterThan(0);
  expect(music_muted.music).toBe(0); expect(music_muted.effects).toBe(full.effects);
  expect(effects_muted.effects).toBe(0); expect(effects_muted.music).toBe(full.music);
  expect(scaled.music / full.music).toBeCloseTo(.5, 6);
  expect(scaled.effects / full.effects).toBeCloseTo(.25, 6);
  expect(measurements.every(entry => entry.silence === 0 && entry.dispatched === 1)).toBe(true);
  await test_info.attach('independent-output-gains', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' });
});
