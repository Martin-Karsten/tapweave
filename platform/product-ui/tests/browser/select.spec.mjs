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
  await expect(page.locator('#map-name')).toHaveText('dropped');
  await expect(page.locator('#objects')).toHaveText('1');
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
