import { test, expect } from '@playwright/test';

test('real audio preserves future ramp prefixes, replacement continuity and parameter masks', async ({ page }, test_info) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { Audio_Service } = await import('/platform/browser-js/src/audio.js');
    const { Audio_Clock } = await import('/platform/browser-js/src/clock.js');
    const offline = new OfflineAudioContext(2, 48000, 48000);
    const context = { currentTime: 0, state: 'running', destination: offline.destination,
      createBufferSource: () => offline.createBufferSource(), createGain: () => offline.createGain(),
      createStereoPanner: () => offline.createStereoPanner() };
    const buffer = offline.createBuffer(1, 48000, 48000);
    buffer.getChannelData(0).fill(1);
    const clock = new Audio_Clock();
    clock.start(0, 0);
    const audio = new Audio_Service(context, clock, { lookahead_ms: 1000 });
    audio.set_assets([[1n, buffer]]);
    const event = (sequence, kind, time_ms, overrides = {}) => ({ sequence: BigInt(sequence), epoch: clock.epoch,
      kind, policy: 'immediate', beatmap_time_ms: time_ms, duration_ms: 0, voice_id: 1n, asset_id: 1n,
      volume: 0, pan: -1, rate: 1, lateness_threshold_ms: 0, ...overrides });
    audio.enqueue([
      event(1, 'loop_start', 0),
      event(2, 'param_ramp', 100, { duration_ms: 400, volume: 1, parameter_mask: 1 }),
      event(3, 'param_ramp', 300, { duration_ms: 400, volume: 0, parameter_mask: 1 }),
      event(4, 'param_ramp', 400, { duration_ms: 200, pan: 1, parameter_mask: 2 }),
      event(5, 'param_ramp', 700, { volume: 0.25, parameter_mask: 1 }),
      event(6, 'loop_stop', 900),
    ]);
    audio.pump();
    const rendered = await offline.startRendering();
    const cleanup_deadline = performance.now() + 1000;
    while ((audio.voices.size || audio.retiring_voices.size) && performance.now() < cleanup_deadline) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const left = rendered.getChannelData(0);
    const right = rendered.getChannelData(1);
    const samples = [0.05, 0.15, 0.25, 0.299, 0.301, 0.4, 0.5, 0.6, 0.699, 0.75, 0.95].map(time_seconds => {
      const sample_index = Math.round(time_seconds * rendered.sampleRate);
      return { time_seconds, left: left[sample_index], right: right[sample_index],
        amplitude: Math.hypot(left[sample_index], right[sample_index]) };
    });
    const owners = { active: audio.voices.size, retiring: audio.retiring_voices.size, pending: audio.pending.length };
    audio.dispose();
    return { samples, owners };
  });
  for (const sample of result.samples) {
    const time = sample.time_seconds;
    const expected_amplitude = time < 0.1 || time >= 0.9 ? 0 : time < 0.3 ? (time - 0.1) / 0.4 :
      time < 0.7 ? 0.5 * (0.7 - time) / 0.4 : 0.25;
    expect(sample.amplitude).toBeCloseTo(expected_amplitude, 3);
    if (time < 0.4) expect(Math.abs(sample.right)).toBeLessThan(0.00001);
    if (time >= 0.6) expect(Math.abs(sample.left)).toBeLessThan(0.00001);
  }
  const middle = result.samples.find(sample => sample.time_seconds === 0.5);
  expect(middle.left).toBeCloseTo(middle.right, 4);
  expect(result.owners).toEqual({ active: 0, retiring: 0, pending: 0 });
  await test_info.attach('audio-automation.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
});

test('real playback-rate automation changes frequency while preserving gain and pan', async ({ page }) => {
  await page.goto('/');
  const cycles = await page.evaluate(async () => {
    const { Audio_Service } = await import('/platform/browser-js/src/audio.js');
    const { Audio_Clock } = await import('/platform/browser-js/src/clock.js');
    const offline = new OfflineAudioContext(2, 48000, 48000);
    const context = { currentTime: 0, state: 'running', destination: offline.destination,
      createBufferSource: () => offline.createBufferSource(), createGain: () => offline.createGain(),
      createStereoPanner: () => offline.createStereoPanner() };
    const buffer = offline.createBuffer(1, 48000, 48000);
    const samples = buffer.getChannelData(0);
    for (let sample_index = 0; sample_index < samples.length; sample_index++) {
      samples[sample_index] = Math.sin(2 * Math.PI * 100 * sample_index / 48000);
    }
    const clock = new Audio_Clock();
    clock.start(0, 0);
    const audio = new Audio_Service(context, clock, { lookahead_ms: 1000 });
    audio.set_assets([[1n, buffer]]);
    const start = { sequence: 1n, epoch: clock.epoch, kind: 'loop_start', policy: 'immediate',
      beatmap_time_ms: 0, duration_ms: 0, voice_id: 1n, asset_id: 1n,
      volume: 0.5, pan: -1, rate: 1, lateness_threshold_ms: 0 };
    audio.enqueue([start, { ...start, sequence: 2n, kind: 'param_ramp', beatmap_time_ms: 200,
      duration_ms: 400, rate: 2, volume: 0, pan: 1, parameter_mask: 4 }]);
    audio.pump();
    const rendered = await offline.startRendering();
    const left = rendered.getChannelData(0);
    const right = rendered.getChannelData(1);
    const intervals = [[0, 0.2], [0.2, 0.6], [0.6, 0.9]].map(([start_seconds, end_seconds]) => {
      let positive_crossings = 0;
      for (let sample_index = Math.max(1, Math.round(start_seconds * 48000)); sample_index < end_seconds * 48000; sample_index++) {
        if (left[sample_index - 1] <= 0 && left[sample_index] > 0) positive_crossings++;
      }
      return positive_crossings;
    });
    // Measure gain after the rate transition: the browser's resampling filter
    // can overshoot during changing playbackRate without changing gain intent.
    const peak = left.subarray(33600, 40800).reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0);
    const right_peak = right.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0);
    audio.dispose();
    return { intervals, peak, right_peak };
  });
  // playbackRate is k-rate (render-quantum sampled), so allow one cycle at
  // interval boundaries while checking the integral of the commanded rate.
  for (const [interval_index, expected] of [20, 60, 60].entries()) {
    expect(Math.abs(cycles.intervals[interval_index] - expected)).toBeLessThanOrEqual(1);
  }
  expect(cycles.peak).toBeCloseTo(0.5, 3);
  expect(cycles.right_peak).toBeLessThan(0.00001);
});
