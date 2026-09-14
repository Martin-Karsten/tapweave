import { test, expect } from '@playwright/test';

// Parity port of platform/browser-js/tests/browser/lifecycle.spec.mjs intent
// for the product shell routes: full attempt lifecycle, keyboard pause,
// resume, retry, authoritative results, audio suspension and GPU restoration.

function music_wav(seconds = 8) {
  const samples = 8000 * seconds;
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40);
  for (let sample_index = 0; sample_index < samples; sample_index++) bytes.writeInt16LE(Math.round(300 * Math.sin(sample_index * Math.PI / 20)), 44 + sample_index * 2);
  return bytes;
}
const mixed = `osu file format v14
[General]
AudioFilename: music.wav
[Difficulty]
HPDrainRate:0
[TimingPoints]
0,500,4,1,1,100,1,0
[HitObjects]
256,192,1500,1,0
256,192,2500,2,0,L|356:192,1,100
256,192,3500,8,0,4500`;

async function load(page, text = mixed) {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('Engine ready');
  await page.locator('#files').setInputFiles([
    { name: 'mixed.osu', mimeType: 'text/plain', buffer: Buffer.from(text) },
    { name: 'music.wav', mimeType: 'audio/wav', buffer: music_wav() },
  ]);
  await expect(page.locator('#start')).toBeEnabled();
}

async function observe_audio(page) {
  await page.addInitScript(() => {
    const NativeAudioContext = window.AudioContext;
    window.AudioContext = class extends NativeAudioContext {
      constructor(...arguments_) { super(...arguments_); window.lifecycle_audio = this; }
    };
  });
}

test('shell plays mixed maps, pauses with keyboard, resumes, retries and shows authoritative results', async ({ page }, test_info) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await load(page);
  await page.locator('#start').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#pause')).toBeVisible();
  await expect(page.locator('#playfield')).toBeFocused();
  await page.keyboard.down('z'); await page.keyboard.press('Escape'); await page.keyboard.up('z');
  await expect(page.locator('#lifecycle-title')).toHaveText('Paused');
  await expect(page.locator('#lifecycle-panel')).toBeFocused();
  // The attempt locks file selection: the select route stays out of reach
  // during play (the vanilla player disabled the input instead).
  await expect(page.locator('#files')).toHaveCount(0);
  await page.locator('#resume').click();
  await expect(page.locator('#pause')).toBeVisible();
  await page.locator('#pause').click();
  await page.locator('#retry').click();
  await expect(page.locator('#pause')).toBeVisible();
  await expect(page.locator('#lifecycle-title')).toHaveText('Passed', { timeout: 12000 });
  await expect(page.locator('#result-stats')).toContainText('Accuracy');
  expect(await page.locator('#result-stats').textContent()).not.toContain('undefined');
  await page.locator('.results-screen').screenshot({ path: test_info.outputPath('results.png') });
  await page.locator('#back').click();
  await expect(page.locator('#start')).toBeEnabled();
  await expect(page.locator('#start')).toBeFocused();
  await expect(page.locator('[data-virtual-list="difficulties"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('audio suspension and real GPU restoration pause together and require an explicit resume', async ({ page }) => {
  await observe_audio(page);
  await load(page);
  await page.locator('#start').click();
  await expect(page.locator('#pause')).toBeVisible();
  await page.evaluate(() => window.lifecycle_audio.suspend());
  await expect(page.locator('#lifecycle-title')).toHaveText('Paused');
  await page.evaluate(() => {
    const canvas = document.getElementById('playfield');
    const extension = canvas.getContext('webgl2').getExtension('WEBGL_lose_context');
    window.lifecycle_graphics = extension;
    extension.loseContext();
  });
  await expect(page.locator('#resume')).toBeDisabled();
  await page.evaluate(() => window.lifecycle_graphics.restoreContext());
  await expect(page.locator('#lifecycle-message')).toContainText('Graphics restored');
  await expect(page.locator('#resume')).toBeEnabled();
  await expect(page.locator('#pause')).toBeHidden();
  await page.locator('#resume').click();
  await expect(page.locator('#pause')).toBeVisible();
});

test('mixed failure results, repeated Back and failed replacement remain usable', async ({ page }) => {
  await load(page, mixed.replace('HPDrainRate:0', 'HPDrainRate:10'));
  await page.locator('#start').click();
  await expect(page.locator('#lifecycle-title')).toHaveText('Failed', { timeout: 12000 });
  await page.locator('#back').click();
  await page.locator('#files').setInputFiles({ name: 'invalid.osu', mimeType: 'text/plain', buffer: Buffer.from('invalid') });
  await expect(page.locator('#error')).toBeVisible();
  await expect(page.locator('#map-name')).toHaveText('mixed');
  await expect(page.locator('#start')).toBeEnabled();
  for (let attempt_index = 0; attempt_index < 3; attempt_index++) {
    await page.locator('#start').click();
    await page.locator('#pause').click();
    await page.locator('#back').click();
    await expect(page.locator('#start')).toBeEnabled();
  }
});

test('interruption renders a copyable report and selects it when clipboard access fails', async ({ page }) => {
  await load(page);
  await page.evaluate(async () => {
    const { Audio_Clock } = await import('/platform/browser-js/src/clock.js');
    Audio_Clock.prototype.input_time = () => -1;
    Object.defineProperty(navigator, 'clipboard', { configurable: true,
      value: { writeText: async () => { throw new Error('Clipboard unavailable'); } } });
  });
  await page.locator('#start').click();
  await expect(page.locator('#pause')).toBeVisible();
  await page.keyboard.press('z');
  await expect(page.locator('#lifecycle-title')).toHaveText('Playback interrupted');
  const report = page.locator('#recovery-report');
  await expect(report).toBeVisible();
  const diagnostic = JSON.parse(await report.inputValue());
  expect(diagnostic.format).toBe('tapweave-debug-report');
  expect(diagnostic.reason).toBe('failure');
  expect(diagnostic.failure.operation).toBe('oe_session_inputs_from_reserved');
  expect(diagnostic.failure.detail.status_name).toBe('LATE_INPUT');
  // keyboard.press delivers keydown and keyup; whether keyup lands in the same
  // rejected batch depends on RAF timing, so only require the keydown batch.
  expect(diagnostic.failure.detail.timing_capture.batch_count).toBeGreaterThanOrEqual(1);
  expect(diagnostic.failure.detail.timing_capture.input_samples[0].mapped.effective_time_ms).toBe(-1);
  expect(diagnostic.identity.map.filename).toBe('mixed.osu');
  expect(diagnostic.identity.sources.osu.commit).toBe('3c1c96f742e7aae2ff67a7361e058fe91ca3b955');
  expect(typeof diagnostic.identity.map.prepared_digest).toBe('string');
  await page.locator('#copy-recovery').click();
  await expect(report).toBeFocused();
  expect(await report.evaluate(element => element.selectionEnd - element.selectionStart)).toBe((await report.inputValue()).length);
  const download_pending = page.waitForEvent('download');
  await page.locator('#download-recovery').click();
  expect((await download_pending).suggestedFilename()).toMatch(/^tapweave-report-/);
});
