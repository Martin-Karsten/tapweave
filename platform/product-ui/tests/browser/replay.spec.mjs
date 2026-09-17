import { test, expect } from '@playwright/test';

// Parity port of pinned lazer replay intent for the product shell results
// route: a saved replay downloads as the TWREPLAY container, watch mode runs
// the replay to completion without user input and displays the same results
// (osu.Game.Tests Visual.Gameplay TestSceneAutoplay at pinned commit
// 3c1c96f7), and exiting the watch never fails the retained result
// (TestSceneReplayPlayer.TestDoesNotFailOnExit). The DOM button/banner are a
// documented divergence from lazer's overlay chrome. The live run includes
// real hits so the recording carries successful input frames, and both
// actions are re-verified after Escape and after natural completion.

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
OverallDifficulty:0
[TimingPoints]
0,500,4,1,1,100,1,0
[HitObjects]
256,192,1500,1,0
256,192,2500,2,0,L|356:192,1,100
256,192,3500,8,0,4500`;

async function load(page) {
  await page.goto('/select');
  await expect(page.locator('#status')).toContainText('Engine ready');
  await page.locator('#files').setInputFiles([
    { name: 'mixed.osu', mimeType: 'text/plain', buffer: Buffer.from(mixed) },
    { name: 'music.wav', mimeType: 'audio/wav', buffer: music_wav() },
  ]);
  await expect(page.locator('#start')).toBeEnabled();
}

// z bursts spanning each hit window (OD 0 gives ±200 ms meh windows): browser
// timing jitter stays far below the span, and presses outside a window are
// ignored rather than penalized, so the circle head and slider head each take
// a hit. The spinner stays unrotated.
const press_burst = async page => {
  for (let press_index = 0; press_index < 5; press_index++) {
    await page.keyboard.press('z');
    await page.waitForTimeout(80);
  }
};

// Start the run and land it on the results route with recorded hits. The
// score assertion keeps this honest: the retained recording contains
// successful input frames, not just cursor idle frames.
async function play_to_results_with_hits(page) {
  await page.locator('#start').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#pause')).toBeVisible();
  await page.waitForTimeout(1300);
  await press_burst(page);
  await page.waitForTimeout(700);
  await press_burst(page);
  await expect(page.locator('#lifecycle-title')).toHaveText('Passed', { timeout: 12000 });
  // Natural completion must leave the results route (not the transient
  // terminal panel on the play route, which carries no replay actions).
  await expect(page).toHaveURL(/\/results$/);
  const score = await score_text(page);
  expect(score, 'the live run must record hits for the replay').not.toBe('0');
  return score;
}

const score_text = page => page.locator('#result-stats dd').first().textContent();

test('results download the replay container and watch it to an identical result without input', async ({ page }, test_info) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await load(page);
  const live_score = await play_to_results_with_hits(page);
  const download_pending = page.waitForEvent('download');
  await page.locator('#save-replay').click();
  expect((await download_pending).suggestedFilename()).toMatch(/^mixed-\d+\.twreplay$/);
  await expect(page.locator('#replay-status')).toHaveText('Replay saved.');
  await page.locator('#watch-replay').click();
  await expect(page).toHaveURL(/\/play$/);
  await expect(page.locator('#watch-banner')).toBeVisible();
  await expect(page.locator('#pause')).toBeHidden();
  // Injected keys must not become gameplay input: the replay alone judges.
  await page.keyboard.press('z');
  await page.keyboard.press('x');
  await page.locator('.play-screen').screenshot({ path: test_info.outputPath('watch.png') });
  await expect(page.locator('#lifecycle-title')).toHaveText('Passed', { timeout: 20000 });
  // Natural completion normalizes back to the original results context: the
  // actions stay usable, Settings is available again and the score matches.
  await expect(page).toHaveURL(/\/results$/);
  await expect(page.locator('#watch-replay')).toBeEnabled();
  await expect(page.locator('.footer-actions button')).toBeEnabled();
  expect(await score_text(page)).toBe(live_score);
  // Retry from the normalized context is a live retry, not another replay.
  await page.locator('#retry').click();
  await expect(page.locator('#pause')).toBeVisible({ timeout: 12000 });
  await expect(page.locator('#watch-banner')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('#lifecycle-title')).toHaveText('Paused');
  await page.locator('#back').click();
  await expect(page.locator('#start')).toBeEnabled();
  expect(errors).toEqual([]);
});

test('Escape exits a watch and both replay actions keep working afterwards', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await load(page);
  const live_score = await play_to_results_with_hits(page);
  await page.locator('#watch-replay').click();
  await expect(page.locator('#watch-banner')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/results$/);
  await expect(page.locator('#lifecycle-title')).toHaveText('Passed');
  expect(await score_text(page)).toBe(live_score);
  // Save serves the retained recording after exiting the watch.
  const download_pending = page.waitForEvent('download');
  await page.locator('#save-replay').click();
  expect((await download_pending).suggestedFilename()).toMatch(/^mixed-\d+\.twreplay$/);
  // Watch re-enters the replay from the retained recording.
  await page.locator('#watch-replay').click();
  await expect(page.locator('#watch-banner')).toBeVisible();
  await expect(page.locator('#lifecycle-title')).toHaveText('Passed', { timeout: 20000 });
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/results$/);
  expect(await score_text(page)).toBe(live_score);
  expect(errors).toEqual([]);
});
