import { test, expect } from '@playwright/test';

async function load(page) {
  const music = Buffer.alloc(44 + 160000);
  music.write('RIFF'); music.writeUInt32LE(music.length - 8, 4); music.write('WAVEfmt ', 8);
  music.writeUInt32LE(16, 16); music.writeUInt16LE(1, 20); music.writeUInt16LE(1, 22);
  music.writeUInt32LE(8000, 24); music.writeUInt32LE(16000, 28);
  music.writeUInt16LE(2, 32); music.writeUInt16LE(16, 34); music.write('data', 36);
  music.writeUInt32LE(160000, 40);
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('Engine ready');
  await page.locator('#files').setInputFiles([
    { name: 'resume.osu', mimeType: 'text/plain', buffer: Buffer.from('osu file format v14\n[General]\nAudioFilename: music.wav\n[Difficulty]\nHPDrainRate:0\n[HitObjects]\n256,192,1000,1,0\n256,192,8000,1,0') },
    { name: 'music.wav', mimeType: 'audio/wav', buffer: music },
  ]);
  await expect(page.locator('#start')).toBeEnabled();
  await page.locator('#start').click();
  await expect(page.locator('#pause')).toBeVisible();
}

const input_state = page => page.evaluate(() => {
  const gameplay = window.__tapweave_player_probe.session.gameplay;
  return { state: gameplay.view.state, held: [...gameplay.frame.input.held_sources.entries()],
    paused_ms: gameplay.playback_clock.paused_beatmap_ms };
});

test('cursor resume freezes time, cancels with Escape, retains held actions and disposes the target', async ({ page }) => {
  await load(page);
  const canvas = page.locator('#playfield');
  const bounds = await canvas.boundingBox();
  await page.mouse.move(bounds.x + bounds.width * .5, bounds.y + bounds.height * .5);
  await page.keyboard.down('x');
  await page.keyboard.press('Escape');
  await expect(page.locator('#resume')).toBeVisible();
  const paused = await input_state(page);
  await page.locator('#resume').click();
  await expect(page.locator('#resume-cursor')).toBeVisible();
  await expect(canvas).toBeFocused();
  expect((await input_state(page)).state).toBe('resuming');
  await page.mouse.move(bounds.x + 5, bounds.y + 5);
  await page.keyboard.press('z');
  expect((await input_state(page)).paused_ms).toBe(paused.paused_ms);
  await expect(page.locator('#resume-cursor')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#resume')).toBeVisible();
  await expect(page.locator('#resume-cursor')).toHaveCount(0);
  await page.locator('#resume').click();
  const target = await page.locator('#resume-cursor').boundingBox();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2);
  await page.keyboard.down('z');
  await expect(page.locator('#pause')).toBeVisible();
  expect((await input_state(page)).held).toEqual([['KeyX', 2], ['KeyZ', 1]]);
  await expect(page.locator('#resume-cursor')).toHaveCount(0);
  await page.keyboard.up('x'); await page.keyboard.up('z');
  expect((await input_state(page)).held).toEqual([]);
  await page.keyboard.press('Escape');
  await page.locator('#resume').click();
  await expect(page.locator('#resume-cursor')).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.locator('#resume-cursor')).toHaveCount(0);
  await expect(page.locator('#resume')).toBeVisible();
});

test('held resume action remains held after release/repress while paused', async ({ page }) => {
  await load(page);
  const bounds = await page.locator('#playfield').boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.keyboard.down('z');
  await page.keyboard.press('Escape');
  await page.keyboard.up('z');
  await page.locator('#resume').click();
  const target = await page.locator('#resume-cursor').boundingBox();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2);
  await page.keyboard.down('z');
  await expect(page.locator('#pause')).toBeVisible();
  expect((await input_state(page)).held).toEqual([['KeyZ', 1]]);
  await page.keyboard.up('z');
  expect((await input_state(page)).held).toEqual([]);
});

test('new paused keys stay inactive while the actual keyboard or mouse resume event is delivered', async ({ page }) => {
  await load(page);
  const bounds = await page.locator('#playfield').boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.keyboard.press('Escape');
  await page.keyboard.down('x');
  await page.locator('#resume').click();
  let target = await page.locator('#resume-cursor').boundingBox();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2);
  await page.keyboard.down('z');
  await expect(page.locator('#pause')).toBeVisible();
  expect((await input_state(page)).held).toEqual([['KeyZ', 1]]);
  await page.keyboard.up('x');
  await page.keyboard.down('x');
  expect((await input_state(page)).held).toEqual([['KeyZ', 1], ['KeyX', 2]]);
  await page.keyboard.up('x');
  await page.keyboard.press('Escape');
  await page.keyboard.up('z');
  await page.locator('#resume').click();
  target = await page.locator('#resume-cursor').boundingBox();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2);
  await page.mouse.down();
  await expect(page.locator('#pause')).toBeVisible();
  expect((await input_state(page)).held).toEqual([['mouse:0', 1]]);
  await page.mouse.up();
  expect((await input_state(page)).held).toEqual([]);
});
