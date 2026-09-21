import { test, expect } from '@playwright/test';

const storage_key = 'tapweave.player-settings.v1';
const defaults = { version: 1, music_volume: 70, effects_volume: 80,
  left_key: 'KeyZ', right_key: 'KeyX', mouse_buttons_enabled: true };

async function open_settings(page) {
  await expect(page.locator('#status')).toContainText('Engine ready');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toBeVisible();
}

function music_wav() {
  const bytes = Buffer.alloc(44 + 8000 * 10 * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  return bytes;
}

async function load_map(page) {
  await page.locator('#files').setInputFiles([
    { name: 'settings.osu', mimeType: 'text/plain', buffer: Buffer.from(`osu file format v14
[General]
AudioFilename: music.wav
[Difficulty]
HPDrainRate:0
[TimingPoints]
0,500,4,1,1,100,1,0
[HitObjects]
256,192,1000,1,0
256,192,8000,1,0`) },
    { name: 'music.wav', mimeType: 'audio/wav', buffer: music_wav() },
  ]);
  await expect(page.locator('#start')).toBeEnabled();
}

test('settings persist, capture rejects conflicts/chords, and modal focus returns to opener', async ({ page }) => {
  await page.goto('/select');
  await open_settings(page);
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await dialog.getByRole('slider', { name: /^Music/ }).fill('0');
  await dialog.getByRole('slider', { name: /^Effects/ }).fill('100');
  await expect(dialog).toContainText('0% (muted)');
  await dialog.getByRole('button', { name: /^Left hit key/ }).click();
  await page.keyboard.press('x');
  await expect(dialog.getByRole('status', { name: 'Settings status' })).toContainText('already assigned');
  await page.keyboard.press('Control+F10');
  await expect(page.locator('#debug-dialog')).toHaveCount(0);
  await page.keyboard.press('Shift+A');
  await expect(dialog.getByRole('status', { name: 'Settings status' })).toContainText('without modifiers');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /^Left hit key/ }).click();
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(dialog.getByRole('status', { name: 'Settings status' })).toContainText('cancelled');
  await dialog.getByRole('button', { name: /^Left hit key/ }).click();
  await page.keyboard.press('Space');
  await expect(dialog.getByRole('button', { name: /^Left hit key/ })).toHaveText('Left hit key: Space');
  await dialog.getByRole('checkbox').uncheck();
  await dialog.getByRole('button', { name: 'Close settings' }).focus();
  await page.keyboard.press('Tab');
  expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeFocused();
  await page.reload();
  await open_settings(page);
  await expect(dialog.getByRole('slider', { name: /^Music/ })).toHaveValue('0');
  await expect(dialog.getByRole('slider', { name: /^Effects/ })).toHaveValue('100');
  await expect(dialog.getByRole('button', { name: /^Left hit key/ })).toHaveText('Left hit key: Space');
  await expect(dialog.getByRole('checkbox')).not.toBeChecked();
  await dialog.getByRole('button', { name: 'Reset to defaults' }).click();
  await expect(dialog.getByRole('status', { name: 'Settings status' })).toContainText('Default settings restored');
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storage_key)).toEqual(defaults);
});

test('unknown storage remains untouched; blocked saving leaves usable preferences and warning', async ({ page }) => {
  await page.addInitScript(({ key }) => {
    localStorage.setItem(key, '{"version":9,"future":true}');
    Storage.prototype.setItem = () => { throw new DOMException('blocked', 'SecurityError'); };
  }, { key: storage_key });
  await page.goto('/select');
  await open_settings(page);
  expect(await page.evaluate(key => localStorage.getItem(key), storage_key)).toBe('{"version":9,"future":true}');
  await page.getByRole('slider', { name: /^Music/ }).fill('20');
  await expect(page.getByRole('alert')).toHaveText('Settings apply for this visit but could not be saved.');
  expect(await page.evaluate(() => window.__tapweave_player_probe.session.settings.snapshot.settings.music_volume)).toBe(20);
});

test('paused settings retain gameplay holds but quarantine captured bindings; mute, retry and disposal work', async ({ page }, test_info) => {
  await page.goto('/select');
  await open_settings(page);
  await page.getByRole('button', { name: 'Close settings' }).click();
  await load_map(page);
  await page.locator('#start').click();
  await expect(page.locator('#pause')).toBeVisible();
  await page.keyboard.down('z');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await dialog.getByRole('slider', { name: /^Music/ }).fill('0');
  await dialog.getByRole('slider', { name: /^Effects/ }).fill('0');
  await dialog.getByRole('button', { name: /^Right hit key/ }).click();
  await page.keyboard.down('Space');
  await page.keyboard.press('Escape');
  await expect(page.locator('#lifecycle-title')).toHaveText('Paused');
  // Native range controls can change window focus differently across engines.
  // Re-establish the original physical source after closing the modal, as in
  // the pinned held-input release/repress-while-paused test.
  await page.keyboard.up('z'); await page.keyboard.down('z');
  await page.evaluate(() => { window.settings_mixer = window.__tapweave_player_probe.session.mixer; });
  await page.locator('#resume').click();
  // Settings update the canvas label before the asynchronous audio resume completes.
  await expect(page.locator('#pause')).toBeVisible();
  await expect(page.locator('#playfield')).toHaveAttribute('aria-label', /Z and Space/);
  const held_count = () => page.evaluate(() => window.__tapweave_player_probe.session.gameplay.frame.input.held_sources.size);
  expect(await page.evaluate(() => [...window.__tapweave_player_probe.session.gameplay.frame.input.held_sources]))
    .toEqual([['KeyZ', 1]]);
  await page.keyboard.up('z'); await page.keyboard.up('Space');
  await page.keyboard.down('Space');
  await expect.poll(held_count).toBe(1);
  await page.keyboard.up('Space');
  await expect.poll(() => page.evaluate(() => window.settings_mixer.music.gain.value)).toBe(0);
  await expect.poll(() => page.evaluate(() => window.settings_mixer.effects.gain.value)).toBe(0);
  const before = await page.evaluate(() => window.__tapweave_player_probe.session.gameplay.playback.last_committed_ms);
  await expect.poll(() => page.evaluate(() => window.__tapweave_player_probe.session.gameplay.playback.last_committed_ms)).toBeGreaterThan(before + 100);
  await page.locator('#pause').click();
  await page.locator('#retry').click();
  await expect(page.locator('#pause')).toBeVisible();
  expect(await page.evaluate(() => window.settings_mixer === window.__tapweave_player_probe.session.mixer)).toBe(true);
  const evidence = await page.evaluate(() => {
    const session = window.__tapweave_player_probe.session;
    return { browser: navigator.userAgent, base_latency: session.audio_context.baseLatency,
      output_latency: session.audio_context.outputLatency ?? null, sample_rate: session.audio_context.sampleRate,
      music_gain: session.mixer.music.gain.value, effects_gain: session.mixer.effects.gain.value,
      message: session.view.message, human_perception: null };
  });
  await test_info.attach('settings-audio-evidence', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
  await page.evaluate(() => window.__tapweave_player_probe.session.dispose());
  expect(await page.evaluate(() => window.settings_mixer.disposed)).toBe(true);
});

test('failed mixer boot closes the context and disconnects its candidate gain', async ({ page }) => {
  await page.addInitScript(() => {
    const create_gain = AudioContext.prototype.createGain;
    const close = AudioContext.prototype.close;
    window.failed_mixer_probe = { created: 0, disconnected: 0, closed: 0 };
    AudioContext.prototype.createGain = function () {
      if (++window.failed_mixer_probe.created === 2) throw new Error('injected mixer failure');
      const gain = create_gain.call(this);
      const disconnect = gain.disconnect.bind(gain);
      gain.disconnect = (...parameters) => { window.failed_mixer_probe.disconnected++; disconnect(...parameters); };
      return gain;
    };
    AudioContext.prototype.close = function () { window.failed_mixer_probe.closed++; return close.call(this); };
  });
  await page.goto('/select');
  await expect(page.locator('#status')).toHaveText('Engine unavailable.');
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => window.failed_mixer_probe)).toEqual({ created: 2, disconnected: 1, closed: 1 });
});
