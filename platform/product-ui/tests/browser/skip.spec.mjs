import { test, expect } from '@playwright/test';

// Phase B (docs/shell-lazer-parity-plan.md) skip coverage, porting the pinned
// osu!lazer TestSceneSkipOverlay intent at 3c1c96f742e7aae2ff67a7361e058fe91ca3b955:
// the affordance appears while a skippable window is open, actuates once with
// the MasterGameplayClockContainer.MINIMUM_SKIP_TIME (1000 ms) lead, and never
// appears when no window exists (TestSkipTimeZero/TestSkipTimeEqualToSkip).
// Divergence: ours is a DOM button outside the canvas input surface; lazer
// overlays the playfield, and lazer offers no break-time skip (ours does,
// targeting one lead before the break ends). The key actuates the same
// affordance as lazer's InputKey.Space -> GlobalAction.SkipCutscene binding
// (whose handler clicks the overlay button): repeats and modifiers ignored,
// and a Space bound as a hit key keeps its gameplay binding.

function music_wav(seconds = 14) {
  const samples = 8000 * seconds;
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40);
  for (let sample_index = 0; sample_index < samples; sample_index++) bytes.writeInt16LE(Math.round(300 * Math.sin(sample_index * Math.PI / 20)), 44 + sample_index * 2);
  return bytes;
}

const lead_in_map = `osu file format v14
[General]
AudioFilename: music.wav
[Difficulty]
HPDrainRate:0
[TimingPoints]
0,500
[HitObjects]
256,192,8000,1,0`;
const break_map = `osu file format v14
[General]
AudioFilename: music.wav
[Difficulty]
HPDrainRate:0
[TimingPoints]
0,500
[Events]
2,2000,7000
[HitObjects]
256,192,1000,1,0
256,192,8000,1,0`;
const equal_lead_map = lead_in_map.replace('8000', '1000');

async function load(page, text) {
  await page.goto('/select');
  await expect(page.locator('#status')).toContainText('Engine ready');
  await page.locator('#files').setInputFiles([
    { name: 'skip.osu', mimeType: 'text/plain', buffer: Buffer.from(text) },
    { name: 'music.wav', mimeType: 'audio/wav', buffer: music_wav() },
  ]);
  await expect(page.locator('#start')).toBeEnabled();
}

const committed_ms = (page) => page.evaluate(() =>
  window.__tapweave_player_probe.session.debug.diagnostics.latest_frame()?.committed_ms ?? null);
const anchor_ms = (page) => page.evaluate(() =>
  window.__tapweave_player_probe.session.playback_clock?.anchor?.beatmap_ms ?? null);

test('lead-in skip appears after start, jumps one lead before the first object and retires', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await load(page, lead_in_map);
  await page.locator('#start').click();
  await expect(page.locator('#pause')).toBeVisible();
  await expect(page.locator('#skip')).toBeVisible();
  // latest_frame() exists only after the first pumped frame; poll for it.
  await expect.poll(() => committed_ms(page), { timeout: 3000 }).toBeLessThan(7000);
  await page.locator('#skip').click();
  await expect(page.locator('#skip')).toBeHidden();
  expect(await anchor_ms(page)).toBeGreaterThanOrEqual(7000);
  // The next frame advances the engine across the whole gap in one call.
  await expect.poll(() => committed_ms(page), { timeout: 3000 }).toBeGreaterThanOrEqual(7000);
  // No input in the gap: the single circle misses and the run still completes.
  await expect(page.locator('#lifecycle-title')).toHaveText('Passed', { timeout: 20000 });
  await expect(page.locator('#skip')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('break skip appears mid-map, jumps one lead before the break ends', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await load(page, break_map);
  await page.locator('#start').click();
  await expect(page.locator('#pause')).toBeVisible();
  await expect(page.locator('#skip')).toBeHidden();
  await expect(page.locator('#skip')).toBeVisible({ timeout: 6000 });
  await page.locator('#skip').click();
  await expect(page.locator('#skip')).toBeHidden();
  expect(await anchor_ms(page)).toBeGreaterThanOrEqual(6000);
  await expect(page.locator('#lifecycle-title')).toHaveText('Passed', { timeout: 20000 });
  expect(errors).toEqual([]);
});

test('no skip affordance when the first object time equals the skip lead', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await load(page, equal_lead_map);
  await page.locator('#start').click();
  await expect(page.locator('#pause')).toBeVisible();
  await expect(page.locator('#skip')).toBeHidden();
  await expect(page.locator('#lifecycle-title')).toHaveText('Passed', { timeout: 10000 });
  await expect(page.locator('#skip')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('space actuates the lead-in skip like the button', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await load(page, lead_in_map);
  await page.locator('#start').click();
  await expect(page.locator('#pause')).toBeVisible();
  await expect(page.locator('#skip')).toBeVisible();
  await expect.poll(() => committed_ms(page), { timeout: 3000 }).toBeLessThan(7000);
  await page.keyboard.press('Space');
  await expect(page.locator('#skip')).toBeHidden();
  expect(await anchor_ms(page)).toBeGreaterThanOrEqual(7000);
  await expect.poll(() => committed_ms(page), { timeout: 3000 }).toBeGreaterThanOrEqual(7000);
  await expect(page.locator('#lifecycle-title')).toHaveText('Passed', { timeout: 20000 });
  await expect(page.locator('#skip')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('space actuates the break skip like the button', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await load(page, break_map);
  await page.locator('#start').click();
  await expect(page.locator('#pause')).toBeVisible();
  await expect(page.locator('#skip')).toBeHidden();
  await expect(page.locator('#skip')).toBeVisible({ timeout: 6000 });
  await page.keyboard.press('Space');
  await expect(page.locator('#skip')).toBeHidden();
  expect(await anchor_ms(page)).toBeGreaterThanOrEqual(6000);
  await expect(page.locator('#lifecycle-title')).toHaveText('Passed', { timeout: 20000 });
  expect(errors).toEqual([]);
});

test('space does nothing when no skip window exists', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await load(page, equal_lead_map);
  await page.locator('#start').click();
  await expect(page.locator('#pause')).toBeVisible();
  await expect(page.locator('#skip')).toBeHidden();
  await page.keyboard.press('Space');
  await expect(page.locator('#skip')).toBeHidden();
  await expect(page.locator('#lifecycle-title')).toHaveText('Passed', { timeout: 10000 });
  await expect(page.locator('#skip')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('space bound as a hit key plays instead of skipping', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('tapweave.player-settings.v1', JSON.stringify({
      version: 1, music_volume: 70, effects_volume: 80,
      left_key: 'Space', right_key: 'KeyX', mouse_buttons_enabled: true,
    }));
  });
  await load(page, lead_in_map);
  await page.locator('#start').click();
  await expect(page.locator('#pause')).toBeVisible();
  await expect(page.locator('#skip')).toBeVisible();
  await expect.poll(() => committed_ms(page), { timeout: 3000 }).toBeLessThan(7000);
  await page.keyboard.press('Space');
  await expect(page.locator('#skip')).toBeVisible();
  await page.waitForTimeout(400);
  expect(await anchor_ms(page)).toBeLessThan(7000);
  expect(errors).toEqual([]);
});
