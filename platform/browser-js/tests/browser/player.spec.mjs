import { test, expect } from '@playwright/test';
import { zipSync, strToU8 } from 'fflate';

const beatmap = 'osu file format v14\n[General]\nAudioFilename: missing.wav\n[Difficulty]\nCircleSize:4\nApproachRate:9\n[HitObjects]\n256,192,1000,1,0';

test('loads real engine, prepares local map and preserves it after failure', async ({ page }) => {
  const page_errors = [];
  page.on('pageerror', error => page_errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('status')).toHaveText('Engine ready. Open a beatmap to begin.');
  await page.getByLabel('Open local files', { exact: true }).setInputFiles({ name: 'local.osu', mimeType: 'text/plain', buffer: Buffer.from(beatmap) });
  await expect(page.getByRole('status')).toHaveText('Beatmap prepared successfully.');
  await expect(page.locator('#objects')).toHaveText('1');
  await expect(page.locator('#map-detail')).toContainText('Main music is missing');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeDisabled();
  await page.getByLabel('Open local files', { exact: true }).setInputFiles({ name: 'bad.osu', mimeType: 'text/plain', buffer: Buffer.from('invalid') });
  await expect(page.getByRole('alert')).toContainText('status 5');
  await expect(page.locator('#map-name')).toHaveText('local');
  await expect(page.locator('#objects')).toHaveText('1');
  expect(page_errors).toEqual([]);
});

test('archive difficulty selection and narrow viewport remain usable', async ({ page }) => {
  const archive = zipSync({ 'Easy.osu': strToU8(beatmap), 'Hard.osu': strToU8(beatmap + '\n128,192,1200,1,0') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('status')).toContainText('Engine ready');
  await page.getByLabel('Open local files', { exact: true }).setInputFiles({ name: 'set.osz', mimeType: 'application/zip', buffer: Buffer.from(archive) });
  await expect(page.getByRole('status')).toContainText('successfully');
  await page.getByLabel('Difficulty', { exact: true }).selectOption('hard.osu');
  await expect(page.locator('#objects')).toHaveText('2');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('malicious archive reports a typed error and diagnostics download works', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('status')).toContainText('Engine ready');
  const archive = zipSync({ '../bad.osu': strToU8(beatmap) });
  await page.getByLabel('Open local files', { exact: true }).setInputFiles({ name: 'bad.osz', mimeType: 'application/zip', buffer: Buffer.from(archive) });
  await expect(page.getByRole('alert')).toContainText('Ambiguous asset path');
  await page.getByText('Diagnostics', { exact: true }).click();
  const download_pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download diagnostics' }).click();
  const download = await download_pending;
  expect(download.suggestedFilename()).toBe('tapweave-diagnostics.json');
  expect(await download.failure()).toBe(null);
});

test('production session and coordinate exports execute in the browser', async ({ page }) => {
  await page.goto('/');
  const observed = await page.evaluate(async map_text => {
    const { Engine_Bridge } = await import('/platform/browser-js/src/engine-bridge.js');
    const engine = await Engine_Bridge.create(await (await fetch('/tapweave.wasm')).arrayBuffer());
    try {
      const prepared = engine.prepare_map(new TextEncoder().encode(map_text));
      const session = engine.create_session(prepared.map_handle, { input_capacity: 64, batch_capacity: 8 });
      engine.release_map(prepared.map_handle);
      const bounds = document.body.getBoundingClientRect();
      const transform = engine.playfield_transform({ css_left: bounds.left, css_top: bounds.top,
        css_width: bounds.width, css_height: bounds.height, device_pixel_ratio: devicePixelRatio });
      const client_x = transform.client_left + 256 * transform.scale;
      const client_y = transform.client_top + 192 * transform.scale;
      const x = client_x * transform.inverse_a + transform.inverse_e;
      const y = client_y * transform.inverse_d + transform.inverse_f;
      engine.submit_inputs(session, [{ sequence: 1n, raw_time_ms: 1000, effective_time_ms: 1000, x, y, action_bits: 1 }]);
      const snapshot = engine.advance(session, 2000);
      engine.acknowledge(session, snapshot.summary.batch_token);
      const final = engine.result(session);
      engine.release_session(session);
      return { x, y, state: final.summary.state, accuracy: final.summary.accuracy,
        owned_sessions: engine.session_handles.size, owned_maps: engine.map_handles.size };
    } finally {
      engine.dispose();
    }
  }, beatmap);
  expect(Math.abs(observed.x - 256)).toBeLessThanOrEqual(1e-6);
  expect(Math.abs(observed.y - 192)).toBeLessThanOrEqual(1e-6);
  expect(observed.state).toBe(3);
  expect(observed.accuracy).toBe(1);
  expect(observed.owned_sessions).toBe(0);
  expect(observed.owned_maps).toBe(0);
});
