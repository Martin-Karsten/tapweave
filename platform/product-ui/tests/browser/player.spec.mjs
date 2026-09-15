import { test, expect } from '@playwright/test';
import { zipSync, strToU8 } from 'fflate';

// Parity port of platform/browser-js/tests/browser/player.spec.mjs intent for
// the product shell: selection, difficulty switching, typed errors,
// diagnostics export and browser-executed engine round-trip.

const beatmap = 'osu file format v14\n[General]\nAudioFilename: missing.wav\n[Difficulty]\nCircleSize:4\nApproachRate:9\n[HitObjects]\n256,192,1000,1,0';

test('loads real engine, prepares local map and preserves it after failure', async ({ page }) => {
  const page_errors = [];
  page.on('pageerror', error => page_errors.push(error.message));
  await page.goto('/select');
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
  await page.goto('/select');
  await expect(page.getByRole('status')).toContainText('Engine ready');
  await page.getByLabel('Open local files', { exact: true }).setInputFiles({ name: 'set.osz', mimeType: 'application/zip', buffer: Buffer.from(archive) });
  await expect(page.getByRole('status')).toContainText('successfully');
  await page.locator('[data-virtual-list="difficulties"] [data-map-filename="hard.osu"]').click();
  await expect(page.locator('#objects')).toHaveText('2');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('malicious archive reports a typed error and diagnostics download works', async ({ page }) => {
  await page.goto('/select');
  await expect(page.getByRole('status')).toContainText('Engine ready');
  const archive = zipSync({ '../bad.osu': strToU8(beatmap) });
  await page.getByLabel('Open local files', { exact: true }).setInputFiles({ name: 'bad.osz', mimeType: 'application/zip', buffer: Buffer.from(archive) });
  await expect(page.getByRole('alert')).toContainText('Ambiguous asset path');
  // The frame navigation chrome is gone; diagnostics is directly addressable.
  await page.goto('/diagnostics');
  const download_pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download diagnostics' }).click();
  const download = await download_pending;
  expect(download.suggestedFilename()).toBe('tapweave-diagnostics.json');
  expect(await download.failure()).toBe(null);
});

test('production session and coordinate exports execute in the browser', async ({ page }) => {
  await page.goto('/diagnostics');
  await page.getByRole('button', { name: 'Run engine round-trip check' }).click();
  await expect(page.locator('[data-self-check="result"]')).toBeVisible({ timeout: 20_000 });
  const observed = await page.evaluate(() => ({
    x: Number(document.querySelector('[data-self-check-value="x"]').textContent),
    y: Number(document.querySelector('[data-self-check-value="y"]').textContent),
    state: document.querySelector('[data-self-check-value="state"]').textContent,
    accuracy: document.querySelector('[data-self-check-value="accuracy"]').textContent,
    owned_sessions: document.querySelector('[data-self-check-value="owned_sessions"]').textContent,
    owned_maps: document.querySelector('[data-self-check-value="owned_maps"]').textContent,
  }));
  expect(Math.abs(observed.x - 256)).toBeLessThanOrEqual(1e-6);
  expect(Math.abs(observed.y - 192)).toBeLessThanOrEqual(1e-6);
  expect(observed.state).toBe('3');
  expect(observed.accuracy).toBe('1');
  expect(observed.owned_sessions).toBe('0');
  expect(observed.owned_maps).toBe('0');
});
