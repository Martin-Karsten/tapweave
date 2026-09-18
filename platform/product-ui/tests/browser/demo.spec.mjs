import { test, expect } from '@playwright/test';

// Original demo beatmap (MVP player experience, "Original demo"): the
// generated tapweave-demo.osz is served same-origin by asset preparation,
// fetched through the same transactional load_files path as a user import,
// and offered from the song-select top bar and the empty-carousel call to
// action. A failed fetch keeps the standing selection and offers Retry; a
// successful demo load is replaceable by loose imports. The archive itself
// is verified byte-for-byte against scripts/demo/manifest.json by the
// generator unit tests and prepare-assets.

const DEMO_URL = '**/demo/tapweave-demo.osz';

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

const loose_beatmap = () =>
  `osu file format v14
[General]
AudioFilename: music.wav
[Metadata]
Title:Replacement Map
Artist:Test Artist
Creator:Test Creator
Version:Normal
[Difficulty]
CircleSize:4
ApproachRate:9
OverallDifficulty:8
HPDrainRate:7
[HitObjects]
256,192,1000,1,0`;

async function wait_ready(page) {
  await page.goto('/select');
  await expect(page.locator('#status')).toContainText('Engine ready');
}

test('first visit loads the demo from the empty-carousel call to action and plays it', async ({ page }, test_info) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await wait_ready(page);
  await expect(page.locator('#try-demo-empty')).toBeVisible();
  await expect(page.locator('#try-demo')).toBeVisible();
  await page.locator('#try-demo-empty').click();
  // Decoder-owned metadata renders once the archive is prepared.
  await expect(page.locator('#map-name')).toHaveText('Tapweave Demo', { timeout: 30000 });
  await expect(page.locator('#map-artist')).toHaveText('Tapweave');
  await expect(page.locator('#map-difficulty')).toHaveText('Beginner');
  await expect(page.locator('#objects')).toHaveText('32');
  await expect(page.locator('.set-title')).toHaveText('Tapweave Demo');
  await expect(page.locator('#start')).toBeEnabled();
  // The explicit Play press is the audio-start gesture; the demo then runs.
  await page.locator('#start').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#pause')).toBeVisible();
  await page.locator('.play-screen').screenshot({ path: test_info.outputPath('demo-play.png') });
  await page.keyboard.press('Escape');
  await expect(page.locator('#lifecycle-title')).toHaveText('Paused');
  await page.locator('#back').click();
  await expect(page.locator('#start')).toBeEnabled();
  expect(errors).toEqual([]);
});

test('a failed demo fetch keeps the standing selection and Retry recovers', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await wait_ready(page);
  await page.locator('#files').setInputFiles([
    { name: 'mixed.osu', mimeType: 'text/plain', buffer: Buffer.from(loose_beatmap()) },
    { name: 'music.wav', mimeType: 'audio/wav', buffer: music_wav() },
  ]);
  await expect(page.locator('#map-name')).toHaveText('Replacement Map');
  await expect(page.locator('#start')).toBeEnabled();

  await page.route(DEMO_URL, async route => {
    await route.abort('failed');
  });
  await page.locator('#try-demo').click();
  await expect(page.locator('#demo-error')).toBeVisible();
  await expect(page.locator('#demo-error-message')).toContainText('Demo download failed');
  // The failed fetch never reached load_files, so the selection stands.
  await expect(page.locator('#map-name')).toHaveText('Replacement Map');
  await expect(page.locator('#start')).toBeEnabled();

  await page.unroute(DEMO_URL);
  await page.locator('#demo-retry').click();
  await expect(page.locator('#map-name')).toHaveText('Tapweave Demo', { timeout: 30000 });
  await expect(page.locator('#demo-error')).toBeHidden();
  await expect(page.locator('#start')).toBeEnabled();
  expect(errors).toEqual([]);
});

test('loose imports replace a loaded demo selection', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await wait_ready(page);
  await page.locator('#try-demo').click();
  await expect(page.locator('#map-name')).toHaveText('Tapweave Demo', { timeout: 30000 });
  await expect(page.locator('#start')).toBeEnabled();
  await page.locator('#files').setInputFiles([
    { name: 'mixed.osu', mimeType: 'text/plain', buffer: Buffer.from(loose_beatmap()) },
    { name: 'music.wav', mimeType: 'audio/wav', buffer: music_wav() },
  ]);
  await expect(page.locator('#map-name')).toHaveText('Replacement Map');
  await expect(page.locator('.set-count')).toContainText('1 difficulty');
  await expect(page.locator('#start')).toBeEnabled();
  expect(errors).toEqual([]);
});
