import { test, expect } from '@playwright/test';
import { zipSync, strToU8 } from 'fflate';

// Song select rework (lazer SongSelect structure): the FilterControl-position
// top bar (back, title, working difficulty filter, import), the sheared set
// panel over the virtualized difficulty rows, drag-and-drop import, the
// BeatmapTitleWedge-position details including OD/HP, and the ScreenFooter
// action bar. A11y/test anchors stay stable for the ported specs.

const beatmap = (extra_objects = 0) =>
  `osu file format v14
[General]
AudioFilename: music.wav
[Difficulty]
CircleSize:4
ApproachRate:9
OverallDifficulty:8
HPDrainRate:7
[HitObjects]
256,192,1000,1,0${extra_objects > 0 ? '\n128,192,1200,1,0' : ''}`;

const beatmap_with_metadata = () =>
  `osu file format v14
[General]
AudioFilename: music.wav
[Metadata]
Title:Song Select Parity
Artist:Test Artist
Creator:Test Creator
Version:Field Coverage
[Difficulty]
CircleSize:4
ApproachRate:9
OverallDifficulty:8
HPDrainRate:7
[HitObjects]
256,192,1000,1,0`;

const beatmap_with_empty_metadata = () =>
  `osu file format v14
[General]
AudioFilename: music.wav
[Metadata]
Title:
Artist:
Creator:
Version:
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

test('top bar and footer Back both return to the menu', async ({ page }) => {
  await wait_ready(page);
  await page.locator('#select-back').click();
  await expect(page).toHaveURL(/\/menu$/);
  await page.goto('/select');
  await page.locator('#footer-back').click();
  await expect(page).toHaveURL(/\/menu$/);
});

// Full-viewport chrome frame (bounding-box comparison like the play-route
// fullscreen assertions): the screen spans the width and all height the slim
// app footer leaves, and the bounded carousel column stretches down to the
// select footer bar so the difficulty list owns the leftover height instead
// of a fixed window.
test('the carousel column fills the full-viewport frame between the bars', async ({ page }) => {
  await wait_ready(page);
  await page.waitForFunction(() =>
    document.querySelector('.select-screen')?.getAnimations().length === 0);
  const viewport = page.viewportSize();
  const screen_box = await page.locator('.select-screen').boundingBox();
  const app_footer_box = await page.locator('.app-footer').boundingBox();
  expect(Math.abs(screen_box.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(screen_box.width - viewport.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(screen_box.height + app_footer_box.height - viewport.height)).toBeLessThanOrEqual(1);

  const carousel_box = await page.locator('.select-carousel').boundingBox();
  const footer_box = await page.locator('.select-footer').boundingBox();
  const row_gap = await page.evaluate(
    () => parseFloat(getComputedStyle(document.querySelector('.select-screen')).rowGap));
  expect(footer_box.y - (carousel_box.y + carousel_box.height)).toBeCloseTo(row_gap, 1);
  expect(Math.abs(footer_box.y + footer_box.height - (screen_box.y + screen_box.height))).toBeLessThanOrEqual(1);
});

test('the set panel counts difficulties and the filter narrows rows', async ({ page }) => {
  await wait_ready(page);
  const archive = zipSync({ 'Easy.osu': strToU8(beatmap()), 'Hard.osu': strToU8(beatmap(1)) });
  await page.getByLabel('Open local files', { exact: true }).setInputFiles({
    name: 'set.osz',
    mimeType: 'application/zip',
    buffer: Buffer.from(archive),
  });
  await expect(page.getByRole('status')).toContainText('successfully');
  await expect(page.locator('.set-panel')).toBeVisible();
  await expect(page.locator('.set-count')).toHaveText('2 difficulties');
  const rows = page.locator('[data-virtual-list="difficulties"] [data-map-filename]');
  await expect(rows).toHaveCount(2);

  await page.getByLabel('Filter difficulties').fill('hard');
  await expect(page.locator('[data-virtual-list="difficulties"] [data-map-filename="hard.osu"]')).toBeVisible();
  await expect(rows).toHaveCount(1);

  await page.getByLabel('Filter difficulties').fill('no such difficulty');
  await expect(page.locator('.filter-empty')).toHaveText('No difficulty matches this filter.');

  await page.getByLabel('Filter difficulties').fill('');
  await expect(rows).toHaveCount(2);
  await page.locator('[data-virtual-list="difficulties"] [data-map-filename="hard.osu"]').click();
  await expect(page.locator('#objects')).toHaveText('2');
});

// WebKit cannot construct synthetic DragEvents carrying a DataTransfer, so
// the drop path runs where the platform delivers it.
test('dropping files onto the screen imports them', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'WebKit automation cannot synthesize file drops');
  await wait_ready(page);
  await page.evaluate((map_text) => {
    const dropped_file = new File([map_text], 'dropped.osu', { type: 'text/plain' });
    const transfer = new DataTransfer();
    transfer.items.add(dropped_file);
    const screen_element = document.querySelector('.select-screen');
    screen_element.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, beatmap());
  await expect(page.locator('.select-screen')).toHaveAttribute('data-drop-active', 'true');
  await expect(page.locator('.select-screen')).toHaveClass(/drop-target/);
  await page.evaluate((map_text) => {
    const dropped_file = new File([map_text], 'dropped.osu', { type: 'text/plain' });
    const transfer = new DataTransfer();
    transfer.items.add(dropped_file);
    const screen_element = document.querySelector('.select-screen');
    screen_element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, beatmap());
  await expect(page.locator('.select-screen')).toHaveAttribute('data-drop-active', 'false');
  await expect(page.getByRole('status')).toHaveText('Beatmap prepared successfully.');
  // The dropped map has no [Metadata]; the decoder default title displays.
  await expect(page.locator('#map-name')).toHaveText('Unknown');
  await expect(page.locator('#objects')).toHaveText('1');
});

test('the wedge shows decoder-owned metadata and falls back only for empty fields', async ({ page }) => {
  await wait_ready(page);
  await page.getByLabel('Open local files', { exact: true }).setInputFiles({
    name: 'meta.osu',
    mimeType: 'text/plain',
    buffer: Buffer.from(beatmap_with_metadata()),
  });
  await expect(page.getByRole('status')).toHaveText('Beatmap prepared successfully.');
  await expect(page.locator('#map-name')).toHaveText('Song Select Parity');
  await expect(page.locator('#map-artist')).toHaveText('Test Artist');
  await expect(page.locator('#map-creator')).toHaveText('mapped by Test Creator');
  await expect(page.locator('#map-difficulty')).toHaveText('Field Coverage');
  await expect(page.locator('.set-title')).toHaveText('Song Select Parity');
  const active_row = page.locator('[data-virtual-list="difficulties"] [data-map-filename="meta.osu"]');
  await expect(active_row).toHaveText('Field Coverage');
  // The filter searches the displayed labels, not only filenames.
  await page.getByLabel('Filter difficulties').fill('field coverage');
  await expect(active_row).toBeVisible();
  await page.getByLabel('Filter difficulties').fill('');

  // A stripped beatmap decodes to the pinned lazer defaults, which are
  // ordinary values (a deliberate Version:Normal or Title:Unknown must not
  // be mistaken for missing metadata) and display like lazer's song select.
  await page.getByLabel('Open local files', { exact: true }).setInputFiles({
    name: 'stripped.osu',
    mimeType: 'text/plain',
    buffer: Buffer.from(beatmap()),
  });
  await expect(page.getByRole('status')).toHaveText('Beatmap prepared successfully.');
  await expect(page.locator('#map-name')).toHaveText('Unknown');
  await expect(page.locator('#map-artist')).toHaveText('Unknown');
  await expect(page.locator('#map-creator')).toHaveText('mapped by Unknown Creator');
  await expect(page.locator('#map-difficulty')).toHaveText('Normal');
  await expect(page.locator('.set-title')).toHaveText('Unknown');
  await expect(page.locator('[data-virtual-list="difficulties"] [data-map-filename="stripped.osu"]'))
    .toHaveText('Normal');

  // Explicitly empty fields count as absent: filename-derived strings return.
  await page.getByLabel('Open local files', { exact: true }).setInputFiles({
    name: 'hollow.osu',
    mimeType: 'text/plain',
    buffer: Buffer.from(beatmap_with_empty_metadata()),
  });
  await expect(page.getByRole('status')).toHaveText('Beatmap prepared successfully.');
  await expect(page.locator('#map-name')).toHaveText('hollow');
  await expect(page.locator('#map-artist')).toHaveCount(0);
  await expect(page.locator('#map-creator')).toHaveCount(0);
  await expect(page.locator('#map-difficulty')).toHaveCount(0);
  await expect(page.locator('.set-title')).toHaveText('hollow');
  await expect(page.locator('[data-virtual-list="difficulties"] [data-map-filename="hollow.osu"]'))
    .toHaveText('hollow');
});

test('the wedge shows CS, AR, OD, HP and object stats from the descriptor', async ({ page }) => {
  await wait_ready(page);
  await page.getByLabel('Open local files', { exact: true }).setInputFiles({
    name: 'local.osu',
    mimeType: 'text/plain',
    buffer: Buffer.from(beatmap(1)),
  });
  await expect(page.getByRole('status')).toHaveText('Beatmap prepared successfully.');
  await expect(page.locator('#objects')).toHaveText('2');
  await expect(page.locator('#circle-size')).toHaveText('4');
  await expect(page.locator('#approach-rate')).toHaveText('9');
  await expect(page.locator('#overall-difficulty')).toHaveText('8');
  await expect(page.locator('#health-drain')).toHaveText('7');
  await expect(page.locator('#map-detail')).toContainText('Main music is missing');
  await expect(page.locator('#play-gate')).toBeVisible();
});

test('non-standard ruleset rejections name the map and keep the technical detail', async ({ page }) => {
  await page.goto('/select');
  await expect(page.getByRole('status')).toContainText('Engine ready');
  const catch_map = beatmap().replace('AudioFilename: music.wav', 'AudioFilename: music.wav\nMode: 2');
  await page.getByLabel('Open local files', { exact: true }).setInputFiles({ name: 'catch.osu', mimeType: 'text/plain', buffer: Buffer.from(catch_map) });
  await expect(page.getByRole('alert')).toContainText('"catch.osu" is a taiko, catch or mania difficulty');
  await expect(page.getByRole('alert')).toContainText('Only osu!standard difficulties are supported');
  await expect(page.locator('#error-detail')).toContainText('UNSUPPORTED');
  // The previous valid selection (if any) stays playable after the refusal.
  await page.getByLabel('Open local files', { exact: true }).setInputFiles({ name: 'standard.osu', mimeType: 'text/plain', buffer: Buffer.from(beatmap()) });
  await expect(page.getByRole('status')).toContainText('successfully');
  await expect(page.locator('#error')).toBeHidden();
});
